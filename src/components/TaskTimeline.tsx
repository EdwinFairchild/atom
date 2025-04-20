import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { TaskData } from '../types'; // Assuming types.ts defines startTime/endTime etc. as bigint

interface TaskTimelineProps {
  tasks: TaskData[];
  cpuFrequency: number;
  windowSize: number; // Assuming windowSize relates to number of tasks, not time duration
  showCrosshair: boolean;
  onTaskSelect: (task: TaskData | null) => void; // Allow null for deselect
  darkMode: boolean;
  selectedTask: TaskData | null;
  windowPosition: number; // Represents the start time (as number) of the visible window
  onWindowPositionChange: (position: number) => void;
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({
  tasks,
  cpuFrequency,
  windowSize, // Note: windowSize seems to be used as task count, not time duration
  showCrosshair,
  onTaskSelect,
  darkMode,
  selectedTask,
  windowPosition, // This is a number representing the start time
  onWindowPositionChange
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const miniTimelineRef = useRef<SVGGElement | null>(null);
  const crosshairRef = useRef<SVGGElement | null>(null);
  const [mainZoom, setMainZoom] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const dragStartRef = useRef<{ x: number; position: number } | null>(null);

  // Calculate the overall time domain using bigint
  const timeDomain = useMemo(() => {
    if (!tasks.length) return [0n, 0n] as [bigint, bigint];
    const start = tasks.reduce((min, d) => d.startTime < min ? d.startTime : min, tasks[0].startTime);
    const end = tasks.reduce((max, d) => d.endTime > max ? d.endTime : max, tasks[0].endTime);
    // Ensure end is strictly greater than start for valid domain
    return [start, end > start ? end : start + 1n] as [bigint, bigint];
  }, [tasks]);

  // Calculate the approximate time duration of the window based on windowPosition (number)
  // This needs careful handling as windowPosition is number, timeDomain is bigint
  const windowTimeWidth = useMemo(() => {
      if (!tasks.length || timeDomain[1] <= timeDomain[0]) return 1n; // Avoid division by zero or negative duration
      // Estimate total duration as Number for proportion calculation
      const totalDurationNum = Number(timeDomain[1] - timeDomain[0]);
      if (totalDurationNum <= 0) return 1n;

      // This calculation assumes windowSize relates to a fraction of the total timeline,
      // which might not be accurate if windowSize is just a task count limit.
      // A more robust approach might be needed depending on the exact meaning of windowSize.
      // For now, let's estimate a width based on a fraction (e.g., 1/10th of total time if windowSize isn't time-based)
      // Or, if windowSize IS meant to be a time duration in cycles:
      // return BigInt(windowSize); // If windowSize is cycles

      // If windowSize is task count, let's estimate a reasonable time width
      // Example: 1/20th of the total duration, minimum 1 cycle
      const estimatedWidth = BigInt(Math.max(1, Math.floor(totalDurationNum / 20)));
      return estimatedWidth;

  }, [tasks, timeDomain]); // Removed windowSize dependency as it seems task-count related

  // Filter tasks based on the *numeric* windowPosition and calculated windowTimeWidth
  const visibleTasks = useMemo(() => {
    if (!tasks.length) return [];

    // Convert numeric windowPosition to BigInt for comparison
    const windowStartBigInt = BigInt(windowPosition);
    const windowEndBigInt = windowStartBigInt + windowTimeWidth;

    // Filter tasks whose time range overlaps with the window
    return tasks
      .filter(task => {
        // Check for overlap: (TaskStart < WindowEnd) and (TaskEnd > WindowStart)
        return task.startTime < windowEndBigInt && task.endTime > windowStartBigInt;
      })
      .sort((a, b) => {
        // Keep existing sort logic
        if (a.name.startsWith('ISR:') && !b.name.startsWith('ISR:')) return -1;
        if (!a.name.startsWith('ISR:') && b.name.startsWith('ISR:')) return 1;
        return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
      });
      // Removed slice based on windowSize, as filtering is now time-based
  }, [tasks, windowPosition, windowTimeWidth]); // Removed windowSize dependency

  const taskNames = useMemo(() => {
    if (!tasks.length) return [];
    // Keep existing sorting logic for task names
    return Array.from(new Set(tasks.map(t => t.name))).sort((a, b) => {
      if (!a || !b) return 0;
      if (a.startsWith('ISR:') && !b.startsWith('ISR:')) return -1;
      if (!a.startsWith('ISR:') && b.startsWith('ISR:')) return 1;
      if (a === '_RTOS_' || a.startsWith('RTOS:')) {
        if (b === '_RTOS_' || b.startsWith('RTOS:')) {
          if (a.startsWith('RTOS:Create') && !b.startsWith('RTOS:Create')) return 1;
          if (!a.startsWith('RTOS:Create') && b.startsWith('RTOS:Create')) return -1;
          return a.localeCompare(b);
        }
        return 1;
      }
      if (b === '_RTOS_' || b.startsWith('RTOS:')) return -1;
      if (a === 'IDLE') return b === '_RTOS_' || b.startsWith('RTOS:') ? -1 : 1;
      if (b === 'IDLE') return a === '_RTOS_' || a.startsWith('RTOS:') ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [tasks]);

  // Format time: Convert bigint cycles to seconds string
  const formatTime = (cycles: bigint) => {
    if (typeof cycles !== 'bigint') {
        console.warn("formatTime received non-bigint:", cycles);
        return 'N/As';
    }
    // Convert bigint to Number for division. May lose precision for huge values.
    return (Number(cycles) / cpuFrequency).toFixed(6) + 's';
  };

  // Get color: No changes needed
  const getTaskColor = (taskName: string) => {
    if (!taskName) return '#000000';
    if (taskName === '_RTOS_' || taskName.startsWith('RTOS:')) {
      return taskName.startsWith('RTOS:Create') ? '#FF8C00' : '#FF4444';
    }
    if (taskName === 'IDLE') return '#9CA3AF';
    if (taskName.startsWith('ISR:')) return '#9333EA';
    // Ensure taskNames is populated before accessing indexOf
    const index = taskNames.length > 0 ? taskNames.indexOf(taskName) : -1;
    return d3.schemeCategory10[index >= 0 ? index % 10 : 0]; // Use index 0 if not found
  };

  const createChart = () => {
    if (!tasks.length || !svgRef.current || !containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const miniTimelineHeight = 60;
    const spaceBetweenCharts = 40;

    const margin = {
      top: 20,
      right: 30,
      bottom: miniTimelineHeight + spaceBetweenCharts + 40,
      left: 120
    };

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    if (width <= 0 || height <= 0) return; // Avoid errors with invalid dimensions

    const svg = d3.select(svgRef.current)
      .attr("width", containerWidth)
      .attr("height", containerHeight);

    svg.selectAll("*").remove();

    // --- Glow Filter (No changes needed) ---
    const defs = svg.append("defs");
    const filter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
    filter.append("feColorMatrix").attr("in", "blur").attr("type", "matrix").attr("values", "0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 1 0").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // --- Tooltip (Ensure creation and styling, no bigint changes) ---
    if (!tooltipRef.current) {
      tooltipRef.current = d3.select(containerRef.current)
        .append('div')
        .attr('class', 'tooltip')
        // ... (keep existing styles)
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('background-color', darkMode ? 'rgba(91, 91, 91, 0.15)' : 'rgba(255, 255, 255, 0.15)')
        .style('backdrop-filter', 'blur(8px)')
        .style('-webkit-backdrop-filter', 'blur(20px)')
        .style('border', '1px solid rgba(255, 255, 255, 0.2)')
        .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)')
        .style('padding', '0.75rem')
        .style('pointer-events', 'none')
        .style('z-index', '50')
        .style('min-width', '200px')
        .style('font-size', '14px')
        .style('color', darkMode ? '#E5E7EB' : '#111827')
        .node() as HTMLDivElement;
    } else {
         // Update styles if they depend on darkMode
         d3.select(tooltipRef.current)
            .style('background-color', darkMode ? 'rgba(91, 91, 91, 0.15)' : 'rgba(255, 255, 255, 0.15)')
            .style('color', darkMode ? '#E5E7EB' : '#111827');
    }


    const mainGroup = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- Crosshair (Setup, no bigint changes) ---
    const crosshairGroup = mainGroup.append("g")
      .attr("class", "crosshair")
      .style("display", showCrosshair ? "block" : "none");
    crosshairRef.current = crosshairGroup.node();
    const crosshairLine = crosshairGroup.append("line")
      .attr("y1", 0).attr("y2", height)
      .attr("stroke", darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)")
      .attr("stroke-width", 1).style("pointer-events", "none");
    const crosshairLabel = crosshairGroup.append("text")
      .attr("y", -5).attr("fill", darkMode ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)")
      .attr("text-anchor", "middle").style("font-size", "12px").style("pointer-events", "none");

    // --- Clip Path (No changes) ---
    svg.append("defs").append("clipPath")
      .attr("id", "clip")
      .append("rect")
      .attr("width", width)
      .attr("height", height);

    // --- Scales ---
    // Mini timeline scale: Domain uses full timeDomain (bigint converted to Number)
    const xScaleMini = d3.scaleLinear()
      .domain([Number(timeDomain[0]), Number(timeDomain[1])]) // Convert bigint domain to Number
      .range([0, width]);

    // Main timeline scale: Domain uses windowPosition (number) and windowTimeWidth (bigint converted to Number)
    const xScaleMain = d3.scaleLinear()
      .domain([windowPosition, windowPosition + Number(windowTimeWidth)]) // Use number position, convert bigint width
      .range([0, width]);

    // Y Scale (No changes)
    const yScaleMain = d3.scaleBand()
      .domain(taskNames)
      .range([0, height])
      .padding(0.2);

    // Color Scale (Uses getTaskColor, which was updated)
    const colorScale = d3.scaleOrdinal()
      .domain(taskNames)
      .range(taskNames.map(getTaskColor));

    // --- Mini Timeline ---
    const miniTimeline = svg.append("g")
      .attr("transform", `translate(${margin.left},${height + margin.top + spaceBetweenCharts})`);
    miniTimelineRef.current = miniTimeline.node();

    miniTimeline.append("rect") // Background
      .attr("x", 0).attr("y", 0).attr("width", width).attr("height", miniTimelineHeight)
      .attr("fill", darkMode ? "#374151" : "#F3F4F6").attr("rx", 4);

    // Density calculation (convert bigint times to Number for scaling)
    const binSize = Math.max(1, width / 200); // Ensure binSize is at least 1
    const numBins = Math.ceil(width / binSize);
    const bins = new Array(numBins).fill(0);
    const miniDomainStartNum = Number(timeDomain[0]);
    const miniDomainEndNum = Number(timeDomain[1]);
    const miniDomainRange = miniDomainEndNum - miniDomainStartNum;

    if (miniDomainRange > 0) { // Avoid division by zero if domain is flat
        tasks.forEach(task => {
            const startNum = Number(task.startTime);
            const endNum = Number(task.endTime);
            // Map time to pixel space using Number scale
            const startPixel = ((startNum - miniDomainStartNum) / miniDomainRange) * width;
            const endPixel = ((endNum - miniDomainStartNum) / miniDomainRange) * width;

            const startBin = Math.max(0, Math.min(numBins - 1, Math.floor(startPixel / binSize)));
            const endBin = Math.max(0, Math.min(numBins - 1, Math.floor(endPixel / binSize)));

            for (let i = startBin; i <= endBin; i++) {
                bins[i]++;
            }
        });
    }


    const maxBinHeight = Math.max(...bins, 1); // Ensure max is at least 1
    const densityScale = d3.scaleLinear()
      .domain([0, maxBinHeight])
      .range([0, miniTimelineHeight]);

    miniTimeline.selectAll("rect.density")
      .data(bins)
      .enter()
      .append("rect")
      .attr("class", "density")
      .attr("x", (d, i) => i * binSize)
      .attr("y", d => miniTimelineHeight - densityScale(d))
      .attr("width", binSize)
      .attr("height", d => densityScale(d))
      .attr("fill", darkMode ? "#6B7280" : "#9CA3AF")
      .attr("opacity", 0.5);

    // Window Indicator (uses numeric windowPosition and converts windowTimeWidth)
    const windowIndicator = miniTimeline.append("rect")
      .attr("class", "window-indicator")
      .attr("y", 0).attr("height", miniTimelineHeight)
      .attr("fill", darkMode ? "#4B5563" : "#E5E7EB").attr("fill-opacity", 0.3)
      .attr("stroke", darkMode ? "#6B7280" : "#9CA3AF").attr("stroke-width", 2)
      .attr("rx", 4).style("cursor", "grab");

    const updateWindowIndicator = () => {
      // Use xScaleMini which operates on Numbers
      const x = xScaleMini(windowPosition);
      const widthIndicator = xScaleMini(windowPosition + Number(windowTimeWidth)) - x;
      windowIndicator
        .attr("x", Math.max(0, Math.min(width - widthIndicator, x))) // Clamp position
        .attr("width", Math.max(2, Math.min(width - x, widthIndicator))); // Clamp width
    };

    updateWindowIndicator(); // Initial position

    // Drag handler for mini timeline window
    const drag = d3.drag<SVGRectElement, unknown>()
      .on("start", (event) => {
        if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
        d3.select(event.sourceEvent.target).style("cursor", "grabbing");
        const miniTimelineNode = miniTimelineRef.current;
        if (miniTimelineNode) {
          const point = d3.pointer(event.sourceEvent, miniTimelineNode);
          dragStartRef.current = {
            x: point[0],
            position: windowPosition // Store the starting numeric position
          };
        }
      })
      .on("drag", (event) => {
        if (dragStartRef.current && miniTimelineRef.current && width > 0) {
          const point = d3.pointer(event.sourceEvent, miniTimelineRef.current);
          const dx = point[0] - dragStartRef.current.x;

          // Calculate position change relative to the *numeric* full domain width
          const fullDomainNumWidth = Number(timeDomain[1]) - Number(timeDomain[0]);
          if (fullDomainNumWidth <= 0) return; // Avoid division by zero

          const positionChange = (dx / width) * fullDomainNumWidth;
          const newNumericPosition = dragStartRef.current.position + positionChange;

          // Clamp the new numeric position within the full numeric domain bounds
          const maxNumericPosition = Number(timeDomain[1]) - Number(windowTimeWidth);
          const clampedNumericPosition = Math.max(Number(timeDomain[0]), Math.min(maxNumericPosition, newNumericPosition));

          onWindowPositionChange(clampedNumericPosition); // Update state with the new numeric position
        }
      })
      .on("end", (event) => {
        d3.select(event.sourceEvent.target).style("cursor", "grab");
        dragStartRef.current = null;
      });

    windowIndicator.call(drag as any);

    // --- Axes ---
    // X Axis (uses xScaleMain, format ticks with formatTime)
    const xAxis = d3.axisBottom(xScaleMain)
      .tickFormat(d => formatTime(BigInt(Math.round(d as number)))); // Convert tick value back to bigint for formatting

    // Y Axis (No changes)
    const yAxis = d3.axisLeft(yScaleMain);

    const xAxisGroup = mainGroup.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .style("color", darkMode ? "#fff" : "#000");
    xAxisGroup.selectAll("text") // Style ticks
      .style("text-anchor", "end").style("font-size", "12px")
      .attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-45)");

    const yAxisGroup = mainGroup.append("g")
      .attr("class", "y-axis")
      .call(yAxis)
      .style("color", darkMode ? "#fff" : "#000");
    yAxisGroup.selectAll("text").style("font-size", "12px");

    // --- Task Rendering Area ---
    const taskGroup = mainGroup.append("g")
      .attr("clip-path", "url(#clip)");

    // Function to update tasks based on zoom/pan/data changes
    const updateTasks = () => {
      // Rescale the main X scale based on the current zoom transform
      const currentXScale = mainZoom.rescaleX(xScaleMain);

      // Data binding for task groups
      const taskGroups = taskGroup.selectAll<SVGGElement, TaskData>("g.task")
        .data(visibleTasks, d => `${d.name}-${d.startTime.toString()}`); // Use bigint.toString() for key

      taskGroups.exit().remove();

      const newTaskGroups = taskGroups.enter()
        .append("g")
        .attr("class", "task");

      // Function to get segments (handles bigint times)
      const getTaskSegments = (task: TaskData) => {
        const segments: { start: bigint, end: bigint, isPreempted: boolean }[] = [];
        if (!task.preemptions || task.preemptions.length === 0) {
          segments.push({ start: task.startTime, end: task.endTime, isPreempted: false });
          return segments;
        }
        const sortedPreemptions = [...task.preemptions].sort((a, b) =>
          a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0
        );
        let currentTime = task.startTime;
        sortedPreemptions.forEach(preemption => {
          // Ensure start/end times are valid bigints
          const pStart = typeof preemption.startTime === 'bigint' ? preemption.startTime : 0n;
          const pEnd = typeof preemption.endTime === 'bigint' ? preemption.endTime : pStart; // Default end to start if invalid

          if (currentTime < pStart) {
            segments.push({ start: currentTime, end: pStart, isPreempted: false });
          }
          // Only add preemption segment if duration is positive
          if (pEnd > pStart) {
              segments.push({ start: pStart, end: pEnd, isPreempted: true });
          }
          currentTime = pEnd > currentTime ? pEnd : currentTime; // Advance time correctly
        });
        if (currentTime < task.endTime) {
          segments.push({ start: currentTime, end: task.endTime, isPreempted: false });
        }
        return segments;
      };

      // Render segments for new and updated tasks
      const renderSegments = (selection: d3.Selection<SVGGElement, TaskData, SVGGElement, unknown>) => {
        selection.each(function(d) {
          const group = d3.select(this);
          group.selectAll("rect").remove(); // Clear previous segments

          const segments = getTaskSegments(d);
          const yPos = yScaleMain(d.name) || 0;
          const bandHeight = yScaleMain.bandwidth();

          segments.forEach(segment => {
            // Convert bigint times to Number for scaling
            const xStart = currentXScale(Number(segment.start));
            const xEnd = currentXScale(Number(segment.end));
            const rectWidth = Math.max(1, xEnd - xStart); // Ensure minimum width of 1px

            // Only render if width is positive and within reasonable bounds
            if (rectWidth > 0 && isFinite(xStart) && isFinite(rectWidth)) {
                group.append("rect")
                  .attr("class", segment.isPreempted ? "preemption-segment" : "normal-segment")
                  .attr("x", xStart)
                  .attr("y", yPos)
                  .attr("width", rectWidth)
                  .attr("height", bandHeight)
                  .attr("fill", colorScale(d.name))
                  .attr("fill-opacity", segment.isPreempted ? 0.3 : (d === selectedTask ? 1 : 0.5))
                  .attr("stroke", colorScale(d.name))
                  .attr("stroke-width", 1)
                  .attr("rx", d.name === '_RTOS_' || d.name.startsWith('RTOS:') ? 4 : 2)
                  .attr("filter", d === selectedTask ? "url(#glow)" : null); // Use null instead of ""
            }
          });
        });
      };

      renderSegments(newTaskGroups); // Render new tasks
      renderSegments(taskGroups);    // Re-render updated tasks

      // --- Interactions (Tooltips, Click) ---
      const handleTaskInteraction = (event: MouseEvent, d: TaskData) => {
        const group = d3.select(event.currentTarget as SVGGElement); // Use currentTarget
        if (d !== selectedTask) {
          group.selectAll("rect.normal-segment")
            .attr("fill-opacity", 1)
            .attr("filter", "url(#glow)");
        }

        // Calculate duration: Convert bigint difference to Number
        const durationBigInt = d.endTime > d.startTime ? d.endTime - d.startTime : 0n;
        const durationMs = (Number(durationBigInt) / cpuFrequency * 1000).toFixed(3);

        let tooltipContent = `
          <div class="space-y-1">
            <div class="font-medium ${darkMode ? 'text-white' : 'text-gray-900'}">${d.name}</div>
            <div class="space-y-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}">
              <div>Duration: ${durationMs}ms</div>
              <div>Start: ${d.startTime.toString()}</div>
              <div>End: ${d.endTime.toString()}</div>
        `; // Display bigint as string

        if (d.preemptions && d.preemptions.length > 0) {
          tooltipContent += `<div class="mt-2"><div class="font-medium">Preemptions:</div>`;
          tooltipContent += d.preemptions.map(p => {
            const pDurationBigInt = p.endTime > p.startTime ? p.endTime - p.startTime : 0n;
            const pDurationMs = (Number(pDurationBigInt) / cpuFrequency * 1000).toFixed(3);
            return `<div>${p.isrName}: runtime ${pDurationMs}ms</div>`;
          }).join('');
          tooltipContent += `</div>`;
        }

        tooltipContent += `</div></div>`;

        if (tooltipRef.current) {
            tooltipRef.current.innerHTML = tooltipContent;
            tooltipRef.current.style.visibility = 'visible';
            // Position tooltip
            const [mouseX, mouseY] = d3.pointer(event, containerRef.current);
            tooltipRef.current.style.left = `${mouseX + 10}px`;
            tooltipRef.current.style.top = `${mouseY - 10}px`;
        }
      };

      const allTaskElements = taskGroup.selectAll<SVGGElement, TaskData>("g.task");

      allTaskElements
        .on("click", (event, d) => {
            event.stopPropagation(); // Prevent click from bubbling to SVG background
            onTaskSelect(d);
        })
        .on("mouseover", handleTaskInteraction)
        .on("mousemove", (event) => { // Update tooltip position on move
            if (tooltipRef.current && tooltipRef.current.style.visibility === 'visible') {
                const [mouseX, mouseY] = d3.pointer(event, containerRef.current);
                tooltipRef.current.style.left = `${mouseX + 10}px`;
                tooltipRef.current.style.top = `${mouseY - 10}px`;
            }
        })
        .on("mouseout", function(event, d) { // Use function to get 'this'
          const group = d3.select(this);
          if (d !== selectedTask) {
            group.selectAll("rect.normal-segment")
              .attr("fill-opacity", 0.5)
              .attr("filter", null); // Use null
          }
          if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
        });

      // Update X axis scale
      xAxisGroup.call(xAxis.scale(currentXScale));
      // Re-apply tick styling as scale changes
       xAxisGroup.selectAll("text")
         .style("text-anchor", "end").style("font-size", "12px")
         .attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-45)");
    };

    // --- Zoom Behavior ---
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10000]) // Increased max zoom
      .extent([[0, 0], [width, height]])
      .translateExtent([[Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]]) // Allow panning anywhere
      .on("zoom", (event) => {
        if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
        setMainZoom(event.transform);
        // No need to call updateTasks here, it's called by the useEffect dependency on mainZoom
      });

    svg.call(zoom);

    // Apply initial/existing zoom transform if not identity
    if (mainZoom !== d3.zoomIdentity) {
      svg.call(zoom.transform, mainZoom);
    }

    // --- Crosshair Interaction ---
    if (showCrosshair) {
      mainGroup.on("mousemove.crosshair", (event) => { // Use namespaced event
        const [x, y] = d3.pointer(event, mainGroup.node());
        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          const currentXScale = mainZoom.rescaleX(xScaleMain);
          // Invert pixel coordinate to get numeric time, then convert to bigint
          const timeNum = currentXScale.invert(x);
          const timeBigInt = BigInt(Math.round(timeNum));

          crosshairLine.attr("x1", x).attr("x2", x);
          crosshairLabel
            .attr("x", x)
            .text(formatTime(timeBigInt)); // Format the bigint time

          crosshairGroup.style("display", "block");
        } else {
          crosshairGroup.style("display", "none");
        }
      });

      mainGroup.on("mouseleave.crosshair", () => { // Use namespaced event
        crosshairGroup.style("display", "none");
      });
    } else {
        mainGroup.on(".crosshair", null); // Remove crosshair listeners if disabled
        crosshairGroup.style("display", "none");
    }

    // --- Background Click for Deselection ---
    svg.on("click", (event) => {
      // Check if the click target is the SVG background itself or the main group
      if (event.target === svg.node() || event.target === mainGroup.node()) {
        onTaskSelect(null); // Deselect task
        // Reset visual state of all tasks
        taskGroup.selectAll<SVGGElement, TaskData>("g.task")
          .selectAll("rect.normal-segment")
          .attr("fill-opacity", 0.5)
          .attr("filter", null);
      }
    });

    // Initial task rendering call
    updateTasks();
    // Initial window indicator update
    updateWindowIndicator();
  }; // End of createChart

  // Effect to re-run chart creation when relevant props/state change
  useEffect(() => {
    createChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskNames, visibleTasks, cpuFrequency, darkMode, selectedTask, mainZoom, windowSize, windowPosition, windowTimeWidth, showCrosshair, containerRef.current]); // Added dependencies

  // Effect for handling resize
  useEffect(() => {
    const handleResize = () => {
      // Re-create chart on resize
      createChart();
    };

    window.addEventListener('resize', handleResize);
    // Initial chart creation after mount
    createChart();

    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount and unmount

  // Effect to update mini timeline window when position changes externally
   useEffect(() => {
       if (svgRef.current && miniTimelineRef.current && tasks.length > 0) {
           const svg = d3.select(svgRef.current);
           const miniTimeline = svg.select<SVGGElement>("g").select<SVGGElement>("g").filter((d, i) => i === 1); // Brittle selection, find better way if possible
           const windowIndicator = miniTimeline.select<SVGRectElement>("rect.window-indicator");

           if (!windowIndicator.empty()) {
               const xScaleMini = d3.scaleLinear()
                   .domain([Number(timeDomain[0]), Number(timeDomain[1])])
                   .range([0, containerRef.current ? containerRef.current.clientWidth - margin.left - margin.right : 0]);

               const x = xScaleMini(windowPosition);
               const width = containerRef.current ? containerRef.current.clientWidth - margin.left - margin.right : 0;
               const widthIndicator = xScaleMini(windowPosition + Number(windowTimeWidth)) - x;

               windowIndicator
                   .attr("x", Math.max(0, Math.min(width - widthIndicator, x)))
                   .attr("width", Math.max(2, Math.min(width - x, widthIndicator)));
           }
       }
   }, [windowPosition, windowTimeWidth, tasks, timeDomain]); // Update when position or width changes


  return (
    <div ref={containerRef} className="timeline-container w-full h-full glass-morphism rounded-md overflow-hidden relative"> {/* Added relative positioning */}
      <svg
        ref={svgRef}
        className="w-full h-full"
      />
      {/* Tooltip div is appended inside containerRef by D3 */}
    </div>
  );
};

export default TaskTimeline;