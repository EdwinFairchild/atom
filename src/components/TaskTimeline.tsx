import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { TaskData } from '../types'; // Assuming types.ts defines startTime/endTime etc. as bigint

interface TaskTimelineProps {
  tasks: TaskData[];
  cpuFrequency: number;
  // windowSize prop is removed as requested
  showCrosshair: boolean;
  onTaskSelect: (task: TaskData | null) => void; // Allow null for deselect
  darkMode: boolean;
  selectedTask: TaskData | null;
  windowPosition: number; // Represents the start time (as number) of the visible window
  onWindowPositionChange: (position: number) => void;
}

// Define margin outside component
const margin = {
    top: 20,
    right: 30,
    bottom: 120, // Adjusted based on miniTimelineHeight, spaceBetweenCharts, axis space
    left: 120
};
const miniTimelineHeight = 40;
const spaceBetweenCharts = 40;


// Helper function to get task segments (remains the same)
const getTaskSegments = (task: TaskData) => {
  const segments: { start: bigint; end: bigint; isPreempted: boolean }[] = [];
  if (!task.preemptions || task.preemptions.length === 0) {
    segments.push({ start: task.startTime, end: task.endTime, isPreempted: false });
    return segments;
  }
  const sortedPreemptions = [...task.preemptions].sort((a, b) =>
    a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0
  );
  let currentTime = task.startTime;
  sortedPreemptions.forEach(preemption => {
    const pStart = typeof preemption.startTime === 'bigint' ? preemption.startTime : 0n;
    const pEnd = typeof preemption.endTime === 'bigint' ? preemption.endTime : pStart;
    if (currentTime < pStart) {
      segments.push({ start: currentTime, end: pStart, isPreempted: false });
    }
    if (pEnd > pStart) {
        segments.push({ start: pStart, end: pEnd, isPreempted: true });
    }
    currentTime = pEnd > currentTime ? pEnd : currentTime;
  });
  if (currentTime < task.endTime) {
    segments.push({ start: currentTime, end: task.endTime, isPreempted: false });
  }
  return segments;
};


const TaskTimeline: React.FC<TaskTimelineProps> = ({
  tasks,
  cpuFrequency,
  showCrosshair,
  onTaskSelect,
  darkMode,
  selectedTask,
  windowPosition,
  onWindowPositionChange,
}) => {
  // --- Refs ---
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const miniTimelineRef = useRef<SVGGElement | null>(null);
  const crosshairRef = useRef<SVGGElement | null>(null);
  const dragStartRef = useRef<{ x: number; position: number } | null>(null);

  // --- State ---
  const [mainZoom, setMainZoom] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, containerWidth: 0, containerHeight: 0 });
  const [hoveredTask, setHoveredTask] = useState<TaskData | null>(null);
  
  const firstAppearanceTimes = useMemo(() => {
    const map = new Map<string, bigint>();
    if (!tasks || tasks.length === 0) return map;

    tasks.forEach(task => {
        if (!map.has(task.name) || task.startTime < map.get(task.name)!) {
            map.set(task.name, task.startTime);
        }
    });
    return map;
}, [tasks]);

  // --- Memoized Data Calculations (Define before hooks that use them) ---

  const timeDomain = useMemo(() => {
    if (!tasks.length) return [0n, 1n] as [bigint, bigint];
    const start = tasks.reduce((min, d) => d.startTime < min ? d.startTime : min, tasks[0].startTime);
    let end = tasks.reduce((max, d) => d.endTime > max ? d.endTime : max, tasks[0].endTime);
    if (end <= start) end = start + 1n;
    return [start, end] as [bigint, bigint];
  }, [tasks]);

  const windowTimeWidth = useMemo(() => {
    if (!tasks.length || timeDomain[1] <= timeDomain[0]) return 1n;
    const totalDurationNum = Number(timeDomain[1] - timeDomain[0]);
    if (totalDurationNum <= 0) return 1n;
    const estimatedWidth = BigInt(Math.max(1, Math.floor(totalDurationNum / 10)));
    return estimatedWidth;
  }, [tasks, timeDomain]);

 const taskNames = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];

    const uniqueNames = Array.from(new Set(tasks.map(t => t.name)));

    // Define sort categories (lower number = higher on the screen)
    const getSortCategory = (name: string): number => {
        if (name === '_RTOS_') return 5;       // Bottom-most
        if (name.startsWith('ISR:')) return 4; // Above RTOS
        if (name === 'RTOS:Create') return 3;  // Above ISRs
        // Add other specific tasks if needed, e.g.:
         if (name === 'IDLE') return 2;
        return 1;                          // All other tasks are category 1 (top-most group)
    };

    uniqueNames.sort((a, b) => {
        const categoryA = getSortCategory(a);
        const categoryB = getSortCategory(b);

        // Sort primarily by category (lower number = higher on screen)
        if (categoryA !== categoryB) {
            return categoryA - categoryB;
        }

        // Secondary sort within the same category
        if (categoryA === 1) {
            // For 'Other Tasks' (category 1), sort by first appearance time
            // Use BigInt comparison directly or convert to Number if safe
            const timeA = firstAppearanceTimes.get(a) ?? 0n; // Default to 0 if not found
            const timeB = firstAppearanceTimes.get(b) ?? 0n;
            // Earlier start time appears higher
            if (timeA < timeB) return -1;
            if (timeA > timeB) return 1;
            return 0; // Should ideally not happen if names are unique
        } else if (categoryA === 3) {
             // For ISRs (category 3), sort alphabetically as a tie-breaker
             return a.localeCompare(b);
        }
        // Add other tie-breakers if needed for other categories

        // Default tie-breaker (shouldn't be reached if categories cover all)
        return a.localeCompare(b);
    });

    return uniqueNames; // This sorted array goes into yScaleMain.domain()

}, [tasks, firstAppearanceTimes]); // Add firstAppearanceTimes as dependency

  // --- Scales (Define after dimensions and taskNames) ---
  const xScaleMini = useMemo(() => {
    if (!dimensions.width) return null;
    return d3.scaleLinear()
      .domain([Number(timeDomain[0]), Number(timeDomain[1])])
      .range([0, dimensions.width]);
  }, [timeDomain, dimensions.width]);

  const xScaleMain = useMemo(() => {
    if (!dimensions.width) return null;
    return d3.scaleLinear()
      .domain([windowPosition, windowPosition + Number(windowTimeWidth)])
      .range([0, dimensions.width]);
  }, [windowPosition, windowTimeWidth, dimensions.width]);

  const yScaleMain = useMemo(() => {
    if (!dimensions.height || !taskNames.length) return null;
    return d3.scaleBand<string>()
      .domain(taskNames)
      .range([0, dimensions.height])
      .padding(0.2);
  }, [taskNames, dimensions.height]);

  // --- Filtered Tasks (Define after scales if pixel filtering used, otherwise after basic data) ---
  const visibleTasks = useMemo(() => {
    if (!tasks.length || !dimensions.width || !xScaleMain) return []; // Need xScaleMain if filtering by pixels
    const windowStartBigInt = BigInt(Math.floor(windowPosition));
    const windowEndBigInt = windowStartBigInt + windowTimeWidth;

    // Get the current zoomed scale for more accurate filtering (optional but good)
    // const currentXScale = mainZoom.rescaleX(xScaleMain);

    return tasks
      .filter(task => {
          // Basic time range check
          return task.endTime > windowStartBigInt && task.startTime < windowEndBigInt;

          // Optional: Pixel-based filtering (can be more efficient if many tasks outside view)
          // const startPixel = currentXScale(Number(task.startTime));
          // const endPixel = currentXScale(Number(task.endTime));
          // return endPixel >= 0 && startPixel <= dimensions.width;
      })
      .sort((a, b) => { // Keep sorting logic if needed for drawing order/layers
        if (a.name.startsWith('ISR:') && !b.name.startsWith('ISR:')) return -1;
        if (!a.name.startsWith('ISR:') && b.name.startsWith('ISR:')) return 1;
        return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
      });
  }, [tasks, windowPosition, windowTimeWidth, dimensions.width, xScaleMain /*, mainZoom */]); // Add mainZoom if using pixel filtering


  // --- Basic Helper Callbacks (Define Early) ---
  const formatTime = useCallback((cycles: bigint) => {
    if (typeof cycles !== 'bigint') return 'N/As';
    return (Number(cycles) / cpuFrequency).toFixed(6) + 's';
  }, [cpuFrequency]);

  const getTaskColor = useCallback((taskName: string) => {
    if (!taskName) return '#000000';
    if (taskName === '_RTOS_' || taskName.startsWith('RTOS:')) {
      return taskName.startsWith('RTOS:Create') ? '#FF8C00' : '#FF4444';
    }
    if (taskName === 'IDLE') return '#9CA3AF';
    if (taskName.startsWith('ISR:')) return '#9333EA';
    const index = taskNames.indexOf(taskName); // taskNames dependency defined above
    return d3.schemeCategory10[index >= 0 ? index % 10 : 0];
  }, [taskNames]);

  // --- Helper: Find Task at Point (Define Before drawSvgComponents) ---
  const findTaskAtPoint = useCallback((
    event: MouseEvent,
    relativeTo: SVGGElement | null, // Should be mainGroup.node()
    currentXScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleBand<string> | null
): TaskData | null => {
    if (!relativeTo || !yScale || !dimensions.width || !dimensions.height) return null;

    // Get pointer coords relative to the passed element (mainGroup)
    const [x, y] = d3.pointer(event, relativeTo); // This 'y' is the one we need to check
    const { width, height } = dimensions;

    if (x < 0 || x > width || y < 0 || y > height) return null;

    const bandHeight = yScale.bandwidth();
    const yDomain = yScale.domain();
    let targetTaskName: string | null = null;

    // --- MORE DEBUG LOGGING ---
    console.log(`findTaskAtPoint using Y: ${y.toFixed(2)}. Checking against bands:`);
    // --- END DEBUG LOGGING ---

    for(const name of yDomain){
        const bandTop = yScale(name);
        if (bandTop === undefined) continue; // Skip if name not in scale

        const bandEnd = bandTop + bandHeight;

        // --- MORE DEBUG LOGGING ---
        const isMatch = (y >= bandTop && y <= bandEnd);
        console.log(`  Task: ${name.padEnd(15)} | bandTop: ${bandTop.toFixed(2)} | bandEnd: ${bandEnd.toFixed(2)} | y>=top? ${y >= bandTop} | y<=end? ${y <= bandEnd} | Match? ${isMatch}`);
        // --- END DEBUG LOGGING ---

        if (isMatch) {
            targetTaskName = name;
            break;
        }
    }

    if (!targetTaskName) {
       console.log(`  No task lane match found for Y = ${y.toFixed(2)}`);
       return null;
    }

    const time = BigInt(Math.round(currentXScale.invert(x)));

       // Find task instance matching name, time, and Y position
       // Iterate backwards through visible tasks for potentially better performance
       for (let i = visibleTasks.length - 1; i >= 0; i--) {
           const task = visibleTasks[i];
           if (task.name === targetTaskName) {
               // Check segments
               const segments = getTaskSegments(task);
               for (const segment of segments) {
                   if (time >= segment.start && time <= segment.end) {
                       // Verify Y again just in case
                       const taskY = yScale(task.name);
                       if (taskY !== undefined && y >= taskY && y <= taskY + bandHeight) {
                           return task; // Found match
                       }
                   }
               }
               // If time is between segments for the correct task name, still no match
           }
       }

       return null; // No task found at this exact point/time
   }, [dimensions, visibleTasks]); // visibleTasks defined above


  // --- Core Drawing Logic Callbacks (Define After Helpers/Data) ---
// Helper function to draw a rounded rectangle path
function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  // Clamp radius to prevent issues on small rectangles
  const effectiveRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  ctx.beginPath();
  ctx.moveTo(x + effectiveRadius, y);
  ctx.lineTo(x + width - effectiveRadius, y);
  ctx.arcTo(x + width, y, x + width, y + effectiveRadius, effectiveRadius);
  ctx.lineTo(x + width, y + height - effectiveRadius);
  ctx.arcTo(x + width, y + height, x + width - effectiveRadius, y + height, effectiveRadius);
  ctx.lineTo(x + effectiveRadius, y + height);
  ctx.arcTo(x, y + height, x, y + height - effectiveRadius, effectiveRadius);
  ctx.lineTo(x, y + effectiveRadius);
  ctx.arcTo(x, y, x + effectiveRadius, y, effectiveRadius);
  ctx.closePath();
}

  const drawCanvasTasks = useCallback(({
    // The object properties it expects
    canvasRef,
    xScaleMain,
    yScaleMain,
    dimensions,
    mainZoom,
    visibleTasks,
    getTaskColor,
    selectedTask,
    hoveredTask,
    darkMode,
    // Explicitly add margin here if it's constant and defined outside
    // If margin can change, add it to the props object type and pass it in calls
} : {
    // Type definition for the expected object
    canvasRef: React.RefObject<HTMLCanvasElement>;
    xScaleMain: d3.ScaleLinear<number, number> | null;
    yScaleMain: d3.ScaleBand<string> | null;
    dimensions: { width: number; height: number; containerWidth: number; containerHeight: number; };
    mainZoom: d3.ZoomTransform;
    visibleTasks: TaskData[];
    getTaskColor: (taskName: string) => string;
    selectedTask: TaskData | null;
    hoveredTask: TaskData | null;
    darkMode: boolean;
    // margin?: { top: number; right: number; bottom: number; left: number; }; // Optional if needed
}) => {
    // Ensure all required elements and data are present
    // Use ?.optionalChaining for refs if preferred, but early return is fine
    if (!canvasRef.current || !xScaleMain || !yScaleMain || !dimensions.width || !dimensions.height) {
      console.warn("drawCanvasTasks: Missing required refs, scales, or dimensions.");
      return;
  }

  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = dimensions;
  const dpr = window.devicePixelRatio || 1;

  // ... (Canvas size and scaling logic - keep as is) ...
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, width, height);

  const currentXScale = mainZoom.rescaleX(xScaleMain);
  const bandHeight = yScaleMain.bandwidth();
  // const cornerRadius = 4; // REMOVED
  const glowBlur = 12;
  const normalFillAlpha = 0.15; // Alpha for default transparent fill
  const hoverFillAlpha = 0.8; // Alpha for hover state
  const preemptedFillAlpha = 0.2;
  const normalLineWidth = 1.5;
  const selectedLineWidth = 1.5;

  // --- Loop through tasks and segments ---
  [...visibleTasks].reverse().forEach(task => {
      const yPos = yScaleMain(task.name);
      if (yPos === undefined) return;

      const segments = getTaskSegments(task); // Assuming getTaskSegments is available
      const taskColor = getTaskColor(task.name);
      const isSelected = selectedTask?.startTime === task.startTime && selectedTask?.name === task.name;
      const isHovered = hoveredTask?.startTime === task.startTime && hoveredTask?.name === task.name;

      segments.forEach(segment => {
          const xStart = currentXScale(Number(segment.start));
          const xEnd = currentXScale(Number(segment.end));

          if (xEnd <= 0 || xStart >= width) return;

          const drawX = Math.max(0, xStart);
          const drawEnd = Math.min(width, xEnd);
          const drawWidth = Math.max(1, drawEnd - drawX); // Ensure min width 1px

          if (drawWidth <= 0) return;

          const isPreempted = segment.isPreempted;

          // --- Reset context properties ---
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
          ctx.globalAlpha = 1.0; // Start full alpha

          // --- Use fillRect and strokeRect ---

          if (isSelected) {
              // Selected State: Solid fill, potentially different border
              ctx.fillStyle = taskColor;
              ctx.globalAlpha = 1.0; // Fully opaque fill
              ctx.fillRect(drawX, yPos, drawWidth, bandHeight); // Use fillRect

              ctx.strokeStyle = darkMode ? '#FFFFFF' : '#000000'; // White/Black border
              ctx.lineWidth = selectedLineWidth;
              ctx.strokeRect(drawX + 0.5, yPos + 0.5, drawWidth - 1, bandHeight - 1); // Inset strokeRect

          } else if (isHovered && !isPreempted) {
              // Hover State (Not Preempted): Transparent fill, solid border, glow
              ctx.fillStyle = taskColor;
              ctx.globalAlpha = hoverFillAlpha; // Transparent fill
              ctx.fillRect(drawX, yPos, drawWidth, bandHeight); // Use fillRect

              // Setup Glow
              ctx.shadowColor = taskColor;
              ctx.shadowBlur = glowBlur;

              // Draw Solid Border (will have glow applied)
              ctx.strokeStyle = taskColor;
              ctx.lineWidth = normalLineWidth;
              ctx.globalAlpha = 1.0; // Border is opaque
              ctx.strokeRect(drawX, yPos, drawWidth, bandHeight); // Use strokeRect (no inset needed unless desired)

              // IMPORTANT: Reset shadow immediately
              ctx.shadowBlur = 0;
              ctx.shadowColor = 'transparent';

          } else if (isPreempted) {
               // Preempted State: Very faint fill
               ctx.fillStyle = taskColor;
               ctx.globalAlpha = preemptedFillAlpha; // Very transparent fill
               ctx.fillRect(drawX, yPos, drawWidth, bandHeight); // Use fillRect
               // No border for preempted by default, add if needed

          } else {
              // Normal State (Not Selected, Not Hovered, Not Preempted)
              ctx.fillStyle = taskColor;
              ctx.globalAlpha = normalFillAlpha; // Transparent fill
              ctx.fillRect(drawX, yPos, drawWidth, bandHeight); // Use fillRect

              // Draw Solid Border
              ctx.strokeStyle = taskColor;
              ctx.lineWidth = normalLineWidth;
              ctx.globalAlpha = 1.0; // Border is opaque
              ctx.strokeRect(drawX, yPos, drawWidth, bandHeight); // Use strokeRect
          }
      }); // End segments loop
  }); // End tasks loop

  // Final reset of globalAlpha
  ctx.globalAlpha = 1.0;

// Dependencies for useCallback
}, [
    // List external variables/functions used INSIDE the callback
    // Refs like canvasRef are stable and don't need to be listed
    xScaleMain, yScaleMain, dimensions, mainZoom, visibleTasks, getTaskColor,
    selectedTask, hoveredTask, darkMode,
    // Add 'margin' here if it's defined outside and could potentially change
    // If getTaskSegments is defined outside and could change, add it too
    getTaskSegments
]);

  const drawSvgComponents = useCallback(() => {
      if (!svgRef.current || !xScaleMini || !xScaleMain || !yScaleMain || !dimensions.width || !dimensions.height) return;

      const { width, height, containerWidth, containerHeight } = dimensions;
      const svg = d3.select(svgRef.current)
          .attr("width", containerWidth)
          .attr("height", containerHeight);

      svg.selectAll("*").remove(); // Clear previous SVG elements

      // --- Tooltip ---
      if (!tooltipRef.current) {
        tooltipRef.current = d3.select(containerRef.current).append('div')
           .attr('class', 'tooltip') // Add tooltip class
           .style('position', 'absolute').style('visibility', 'hidden')
           .style('background-color', darkMode ? 'rgba(91, 91, 91, 0.15)' : 'rgba(255, 255, 255, 0.15)')
           .style('backdrop-filter', 'blur(8px)').style('-webkit-backdrop-filter', 'blur(20px)')
           .style('border', '1px solid rgba(255, 255, 255, 0.2)')
           .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)')
           .style('padding', '0.75rem').style('pointer-events', 'none')
           .style('z-index', '50').style('min-width', '200px')
           .style('font-size', '14px').style('color', darkMode ? '#E5E7EB' : '#111827')
           .node() as HTMLDivElement;
      } else {
         d3.select(tooltipRef.current) // Update style based on darkMode
            .style('background-color', darkMode ? 'rgba(91, 91, 91, 0.15)' : 'rgba(255, 255, 255, 0.15)')
            .style('color', darkMode ? '#E5E7EB' : '#111827');
      }

      // --- Main Chart Group & Interaction Background ---
      const mainGroup = svg.append("g")
          .attr("class", "main-chart-group")
          .attr("transform", `translate(${margin.left},${margin.top})`);

      mainGroup.append("rect")
          .attr("class", "interaction-background")
          .attr("width", width)
          .attr("height", height)
          .attr("fill", "transparent")
          .style("pointer-events", "all")
          .on("click", (event) => {
              const currentXScale = mainZoom.rescaleX(xScaleMain);
              const task = findTaskAtPoint(event, mainGroup.node(), currentXScale, yScaleMain); // findTaskAtPoint defined above
              if (!task) {
                  onTaskSelect(null);
                  setHoveredTask(null);
              } else {
                  onTaskSelect(task);
              }
          })
          .on("mousemove", (event) => {
              const currentXScale = mainZoom.rescaleX(xScaleMain);
              const svgPoint = d3.pointer(event); // Coords relative to SVG container
              const mainGroupPoint = d3.pointer(event, mainGroup.node()); // Coords relative to mainGroup
              console.log(`SVG Mouse: [${svgPoint[0].toFixed(2)}, ${svgPoint[1].toFixed(2)}] | mainGroup Mouse: [${mainGroupPoint[0].toFixed(2)}, ${mainGroupPoint[1].toFixed(2)}]`);
              const task = findTaskAtPoint(event, mainGroup.node(), currentXScale, yScaleMain);
              setHoveredTask(task); // Update state, triggers canvas redraw via effect

              if (task && tooltipRef.current) {
                  const durationBigInt = task.endTime > task.startTime ? task.endTime - task.startTime : 0n;
                  const durationMs = (Number(durationBigInt) / cpuFrequency * 1000).toFixed(3);
                  let tooltipContent = `<div class="space-y-1"><div class="font-medium ${darkMode ? 'text-white' : 'text-gray-900'}">${task.name}</div><div class="space-y-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}"><div>Duration: ${durationMs}ms</div><div>Start: ${task.startTime.toString()}</div><div>End: ${task.endTime.toString()}</div>`;
                    if (task.preemptions && task.preemptions.length > 0) {
                    tooltipContent += `<div class="mt-2"><div class="font-medium">Preemptions:</div>`;
                    tooltipContent += task.preemptions.map(p => {
                        const pDurationBigInt = p.endTime > p.startTime ? p.endTime - p.startTime : 0n;
                        const pDurationMs = (Number(pDurationBigInt) / cpuFrequency * 1000).toFixed(3);
                        return `<div>${p.isrName}: runtime ${pDurationMs}ms</div>`;
                    }).join('');
                    tooltipContent += `</div>`;
                    }
                    tooltipContent += `</div></div>`;
                  tooltipRef.current.innerHTML = tooltipContent;
                  tooltipRef.current.style.visibility = 'visible';
                  const [mouseX, mouseY] = d3.pointer(event, containerRef.current);
                  tooltipRef.current.style.left = `${mouseX + 10}px`;
                  tooltipRef.current.style.top = `${mouseY - 10}px`;
              } else if (tooltipRef.current) {
                  tooltipRef.current.style.visibility = 'hidden';
              }

              // Crosshair logic
              if (showCrosshair && crosshairRef.current) {
                 const [x, y] = d3.pointer(event, mainGroup.node());
                 if (x >= 0 && x <= width && y >= 0 && y <= height) {
                    const timeNum = currentXScale.invert(x);
                    const timeBigInt = BigInt(Math.round(timeNum));
                    d3.select(crosshairRef.current).select('line').attr("x1", x).attr("x2", x);
                    d3.select(crosshairRef.current).select('text').attr("x", x).text(formatTime(timeBigInt)); // formatTime defined above
                    d3.select(crosshairRef.current).style("display", null);
                 } else {
                    d3.select(crosshairRef.current).style("display", "none");
                 }
              }
          })
          .on("mouseleave", () => {
              setHoveredTask(null);
              if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
              if (crosshairRef.current) d3.select(crosshairRef.current).style("display", "none");
          });

      // --- Axes ---
      const currentXAxisScale = mainZoom.rescaleX(xScaleMain); // Use zoomed scale for axis
      const xAxis = d3.axisBottom(currentXAxisScale)
          .tickFormat(d => formatTime(BigInt(Math.round(d as number)))); // formatTime defined above
      const yAxis = d3.axisLeft(yScaleMain);

      mainGroup.append("g")
          .attr("class", "x-axis")
          .attr("transform", `translate(0,${height})`)
          .call(xAxis)
          .style("color", darkMode ? "#fff" : "#000")
          .selectAll("text")
              .style("text-anchor", "end").style("font-size", "12px")
              .attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-45)");

      mainGroup.append("g")
          .attr("class", "y-axis")
          .call(yAxis)
          .style("color", darkMode ? "#fff" : "#000")
          .selectAll("text").style("font-size", "12px");

      // --- Crosshair SVG Elements ---
      if (showCrosshair) {
        const crosshairGroup = mainGroup.append("g")
          .attr("class", "crosshair")
          .style("display", "none")
          .style("pointer-events", "none");
        crosshairRef.current = crosshairGroup.node(); // Store ref
        crosshairGroup.append("line")
          .attr("y1", 0).attr("y2", height)
          .attr("stroke", darkMode ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)")
          .attr("stroke-width", 1);
        crosshairGroup.append("text")
          .attr("y", -5).attr("fill", darkMode ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)")
          .attr("text-anchor", "middle").style("font-size", "12px");
      } else {
        crosshairRef.current = null;
      }

      // --- Mini Timeline main section ---
      miniTimelineRef.current = svg.append("g") // Store ref
          .attr("class", "mini-timeline")
          .attr("transform", `translate(${margin.left},${height + margin.top + spaceBetweenCharts + 30})`)
          .node();

      const miniTimelineGroup = d3.select(miniTimelineRef.current);

      miniTimelineGroup.append("rect") // Background
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", miniTimelineHeight)
        .attr("fill", darkMode ? "#374151" : "#E5E7EB") // Adjust color (example: light gray for light mode)
        .attr("fill-opacity", 0.1) // Set opacity (0 to 1, 0.7 for slight transparency)
        .attr("rx", 4); // Rounded corners

      // --- Density Plot (SVG version) ---
      const binSize = Math.max(1, width / 200);
      const numBins = Math.ceil(width / binSize);
      const bins = new Array(numBins).fill(0);
      const miniDomainStartNum = Number(timeDomain[0]);
      const miniDomainEndNum = Number(timeDomain[1]);
      const miniDomainRange = miniDomainEndNum - miniDomainStartNum;

      if (miniDomainRange > 0) {
          tasks.forEach(task => {
              const startNum = Number(task.startTime);
              const endNum = Number(task.endTime);
              const startPixel = ((startNum - miniDomainStartNum) / miniDomainRange) * width;
              const endPixel = ((endNum - miniDomainStartNum) / miniDomainRange) * width;
              const startBin = Math.max(0, Math.min(numBins - 1, Math.floor(startPixel / binSize)));
              const endBin = Math.max(0, Math.min(numBins - 1, Math.floor(endPixel / binSize)));
              for (let i = startBin; i <= endBin; i++) bins[i]++;
          });
      }
      const maxBinHeight = Math.max(...bins, 1);
      const densityScale = d3.scaleLinear().domain([0, maxBinHeight]).range([0, miniTimelineHeight]);

      miniTimelineGroup.selectAll("rect.density")
        .data(bins).enter().append("rect")
        .attr("class", "density")
        .attr("x", (d, i) => i * binSize).attr("y", d => miniTimelineHeight - densityScale(d))
        .attr("width", binSize).attr("height", d => densityScale(d))
        .attr("fill", darkMode ? "#6B7280" : "#9CA3AF").attr("opacity", 0.5);
      // --- End Density Plot ---


      // --- Window Indicator : small grabber window---
      const windowIndicator = miniTimelineGroup.append("rect")
    .attr("class", "window-indicator")
    .attr("y", 0)
    .attr("height", miniTimelineHeight)
    .attr("fill", "#FF0000") // Set fill to red
    .attr("fill-opacity", 0.1) // Adjust transparency (0 to 1, where 0.3 is semi-transparent)
    .attr("stroke", "#FF0000") // Solid red border
    .attr("stroke-width", 2) // Border thickness
    .attr("rx", 4) // Rounded corners
    .style("cursor", "grab")
    .style("pointer-events", "all");
      const updateWindowIndicator = () => {
          if (!xScaleMini) return;
          const x = xScaleMini(windowPosition);
          const widthIndicator = xScaleMini(windowPosition + Number(windowTimeWidth)) - x;
          windowIndicator
              .attr("x", Math.max(0, Math.min(width - widthIndicator, x)))
              .attr("width", Math.max(2, Math.min(width, widthIndicator)));
      };
      updateWindowIndicator(); // Initial update

      // --- Drag handler for mini timeline window ---
      const drag = d3.drag<SVGRectElement, unknown>()
          .on("start", (event) => {
              if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
              d3.select(event.sourceEvent.target).style("cursor", "grabbing");
              const miniTimelineNode = miniTimelineRef.current;
              if (miniTimelineNode) {
                  const point = d3.pointer(event.sourceEvent, miniTimelineNode);
                  dragStartRef.current = { x: point[0], position: windowPosition };
              }
          })
          .on("drag", (event) => {
              if (dragStartRef.current && miniTimelineRef.current && width > 0 && timeDomain[1] > timeDomain[0]) {
                  const point = d3.pointer(event.sourceEvent, miniTimelineRef.current);
                  const dx = point[0] - dragStartRef.current.x;
                  const fullDomainNumWidth = Number(timeDomain[1]) - Number(timeDomain[0]);
                  if (fullDomainNumWidth <= 0) return;

                  const positionChange = (dx / width) * fullDomainNumWidth;
                  const newNumericPosition = dragStartRef.current.position + positionChange;

                  const maxNumericPosition = Number(timeDomain[1]) - Number(windowTimeWidth);
                  const clampedNumericPosition = Math.max(Number(timeDomain[0]), Math.min(maxNumericPosition, newNumericPosition));

                  onWindowPositionChange(Math.floor(clampedNumericPosition)); // Update state
              }
          })
          .on("end", (event) => {
              d3.select(event.sourceEvent.target).style("cursor", "grab");
              dragStartRef.current = null;
          });
      windowIndicator.call(drag as any);

      // --- Zoom Behavior ---
      const zoom = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([1, 100000])
          .extent([[margin.left, margin.top], [containerWidth - margin.right, containerHeight - margin.bottom]]) // Zoom extent relative to SVG container
          .translateExtent([[Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]])
          .filter(event => !event.target || !(event.target as Element).closest('.window-indicator')) // Prevent zoom when dragging indicator
          .on("zoom", (event) => {
              if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
               // Prevent zoom when dragging mini timeline indicator
              if (event.sourceEvent && (event.sourceEvent.target as Element).classList.contains('window-indicator')) {
                return;
              }
              setMainZoom(event.transform); // Trigger re-render -> redraws via effects
          });

      svg.call(zoom);
      svg.call(zoom.transform, mainZoom); // Apply current zoom transform

  }, [ // Dependencies for drawSvgComponents
      dimensions, darkMode, xScaleMini, xScaleMain, yScaleMain, mainZoom, tasks, taskNames,
      timeDomain, windowPosition, windowTimeWidth, cpuFrequency, showCrosshair,
      formatTime, // Callback dep
      findTaskAtPoint, // Callback dep
      onWindowPositionChange, // Prop dep
      onTaskSelect // Prop dep
  ]);


  // --- Effects ---

  // Update dimensions on resize
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || !entries.length) return;
      const entry = entries[0];
      const contWidth = entry.contentRect.width;
      const contHeight = entry.contentRect.height;
      setDimensions({
        containerWidth: contWidth,
        containerHeight: contHeight,
        width: Math.max(0, contWidth - margin.left - margin.right),
        height: Math.max(0, contHeight - margin.top - margin.bottom),
      });
      // Reset zoom on resize? Or try to maintain position? Resetting is simpler.
      setMainZoom(d3.zoomIdentity);
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []); // Run once on mount


  // Main effect to draw SVG and Canvas when major data/dimensions change
  useEffect(() => {
      if (!dimensions.width || !dimensions.height || !tasks.length || !xScaleMain || !yScaleMain) {
          // Clear if no dimensions, data, or essential scales
          if (canvasRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) {
                  const dpr = window.devicePixelRatio || 1;
                  ctx.clearRect(0, 0, dimensions.width * dpr, dimensions.height * dpr);
              }
          }
          if (svgRef.current) {
              d3.select(svgRef.current).selectAll("*").remove();
          }
          return;
      };

      // 1. Draw SVG components (axes, mini timeline, interaction listeners)
      drawSvgComponents();

      // 2. Setup Canvas dimensions (after SVG group established if using margins)
      if (canvasRef.current) {
          const canvas = canvasRef.current;
          const dpr = window.devicePixelRatio || 1;
          const ctx = canvas.getContext('2d');
          if (ctx) {
              canvas.width = dimensions.width * dpr;
              canvas.height = dimensions.height * dpr;
              canvas.style.width = `${dimensions.width}px`;
              canvas.style.height = `${dimensions.height}px`;
              ctx.scale(dpr, dpr); // Scale context for high DPI
          }
      }

      // 3. Draw tasks onto the canvas
      drawCanvasTasks({ // Pass the required object
        canvasRef,
        xScaleMain,
        yScaleMain,
        dimensions,
        mainZoom,
        visibleTasks,
        getTaskColor,
        selectedTask,
        hoveredTask,
        darkMode
        // Pass margin here if needed by the function's type def
    });

  }, [
      tasks, // Redraw if tasks change
      dimensions, // Redraw on resize
      drawSvgComponents, // Callback dependency
      drawCanvasTasks, // Callback dependency
      xScaleMain, // Needed to check if ready
      yScaleMain // Needed to check if ready
      // Note: Callbacks include their own dependencies internally
  ]);


  // Effect to specifically redraw Canvas when interaction state changes (zoom, select, hover)
  useEffect(() => {
      // Avoid drawing if scales aren't ready
      if (!xScaleMain || !yScaleMain) return;
      drawCanvasTasks({ // Pass the required object again
        canvasRef,
        xScaleMain,
        yScaleMain,
        dimensions,
        mainZoom,
        visibleTasks,
        getTaskColor,
        selectedTask,
        hoveredTask,
        darkMode
        // Pass margin here if needed
    });
  }, [mainZoom, selectedTask, hoveredTask, darkMode, drawCanvasTasks, xScaleMain, yScaleMain]); // Added scale checks


  // Effect to update just the X axis and window indicator on pan/zoom/position change
   useEffect(() => {
       // Avoid updates if core elements/scales aren't ready
       if (!svgRef.current || !xScaleMain || !xScaleMini || !yScaleMain || !dimensions.width || !dimensions.height || !miniTimelineRef.current) return;

       const svg = d3.select(svgRef.current);
       const mainGroup = svg.select<SVGGElement>("g.main-chart-group");
       const miniTimelineGroup = d3.select(miniTimelineRef.current);

       // Update X Axis
       if (mainGroup.size() > 0) {
         const currentXAxisScale = mainZoom.rescaleX(xScaleMain);
         const xAxis = d3.axisBottom(currentXAxisScale)
           .tickFormat(d => formatTime(BigInt(Math.round(d as number)))); // formatTime defined above
         mainGroup.select<SVGGElement>("g.x-axis")
            .transition().duration(0) // Prevent transitions during zoom/pan
            .attr("transform", `translate(0,${dimensions.height})`)
            .call(xAxis)
            .selectAll("text")
                .style("text-anchor", "end").style("font-size", "12px")
                .attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-45)");
       }

       // Update Mini Timeline Indicator
       const windowIndicator = miniTimelineGroup.select<SVGRectElement>("rect.window-indicator");
       if (windowIndicator.size() > 0) {
           const x = xScaleMini(windowPosition);
           const widthIndicator = xScaleMini(windowPosition + Number(windowTimeWidth)) - x;
           windowIndicator
               .attr("x", Math.max(0, Math.min(dimensions.width - widthIndicator, x)))
               .attr("width", Math.max(2, Math.min(dimensions.width, widthIndicator)));
       }

   }, [mainZoom, windowPosition, windowTimeWidth, xScaleMain, xScaleMini, yScaleMain, dimensions, formatTime]);


  // --- Render ---
  return (
    <div ref={containerRef} className="timeline-container w-full h-full glass-morphism  rounded-md overflow-hidden relative">
        {/* Canvas for tasks (drawn first, underneath) */}
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                // POSITION the canvas element using margins
                left: `${margin.left}px`,
                top: `${margin.top}px`,
                // SIZE the canvas element to the plotting area
                width: `${dimensions.width}px`,   // Use plotting width
                height: `${dimensions.height}px`, // Use plotting height
                pointerEvents: 'none'
            }}
            // Width/Height attributes set dynamically for resolution
        />
        {/* SVG for axes, interactions, overlays (drawn on top) */}
        <svg
            ref={svgRef}
            className="w-full h-full" // SVG still covers the whole container
            style={{
                position: 'absolute',
                left: 0,
                top: 0
            }}
        >
            {/* D3 populates SVG, mainGroup is translated */}
        </svg>
        {/* Tooltip div */}
    </div>
  );
};

export default TaskTimeline;