import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { TaskData } from '../types';

interface TaskTimelineProps {
  tasks: TaskData[];
  cpuFrequency: number;
  windowSize: number;
  showCrosshair: boolean;
  onTaskSelect: (task: TaskData) => void;
  darkMode: boolean;
  selectedTask: TaskData | null;
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({ 
  tasks, 
  cpuFrequency, 
  windowSize,
  showCrosshair,
  onTaskSelect, 
  darkMode, 
  selectedTask 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const miniTimelineRef = useRef<SVGGElement | null>(null);
  const crosshairRef = useRef<SVGGElement | null>(null);
  const [windowPosition, setWindowPosition] = useState<number>(0);
  const [mainZoom, setMainZoom] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const dragStartRef = useRef<{ x: number; position: number } | null>(null);

  const timeDomain = useMemo(() => {
    const start = d3.min(tasks, d => d.startTime) || 0;
    const end = d3.max(tasks, d => d.endTime) || 0;
    return [start, end] as [number, number];
  }, [tasks]);

  const windowWidth = useMemo(() => {
    if (!tasks.length) return 0;
    const sortedTasks = [...tasks].sort((a, b) => a.startTime - b.startTime);
    const tasksInWindow = sortedTasks.slice(0, windowSize);
    return tasksInWindow[tasksInWindow.length - 1]?.endTime - tasksInWindow[0]?.startTime;
  }, [tasks, windowSize]);

  const visibleTasks = useMemo(() => {
    if (!tasks.length) return [];
    const windowEnd = windowPosition + windowWidth;
    return tasks
      .filter(task => task.startTime >= windowPosition && task.startTime <= windowEnd)
      .sort((a, b) => {
        // Sort ISRs to the top
        if (a.name.startsWith('ISR:') && !b.name.startsWith('ISR:')) return -1;
        if (!a.name.startsWith('ISR:') && b.name.startsWith('ISR:')) return 1;
        return a.startTime - b.startTime;
      })
      .slice(0, windowSize);
  }, [tasks, windowPosition, windowWidth, windowSize]);

  const taskNames = useMemo(() => {
    return Array.from(new Set(tasks.map(t => t.name))).sort((a, b) => {
      if (a.startsWith('ISR:') && !b.startsWith('ISR:')) return -1;
      if (!a.startsWith('ISR:') && b.startsWith('ISR:')) return 1;
      if (a === '_RTOS_') return 1;
      if (b === '_RTOS_') return -1;
      if (a === 'IDLE') return b === '_RTOS_' ? -1 : 1;
      if (b === 'IDLE') return a === '_RTOS_' ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [tasks]);

  const formatTime = (cycles: number) => {
    const seconds = cycles / cpuFrequency;
    return seconds.toFixed(6) + 's';
  };

  const getTaskColor = (taskName: string) => {
    if (taskName === '_RTOS_') return '#FF4444';
    if (taskName === 'IDLE') return '#9CA3AF';
    if (taskName.startsWith('ISR:')) return '#9333EA'; // Purple for ISRs
    return d3.schemeCategory10[taskNames.indexOf(taskName) % 10];
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
  
    const svg = d3.select(svgRef.current)
      .attr("width", containerWidth)
      .attr("height", containerHeight);
  
    svg.selectAll("*").remove();
  
    // Ensure tooltip exists
    if (!tooltipRef.current) {
      tooltipRef.current = d3.select(containerRef.current)
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('border-radius', '0.375rem')
        .style('padding', '0.75rem')
        .style('pointer-events', 'none')
        .style('z-index', '50')
        .style('min-width', '200px')
        .style('font-size', '14px')
        .node() as HTMLDivElement;
    }
  
    // Update tooltip styles with glassmorphism effect
    d3.select(tooltipRef.current)
      .style('background-color', darkMode ? 'rgba(91, 91, 91, 0.15)' :'rgba(255, 255, 255, 0.15)') // Semi-transparent background for glass effect
      .style('backdrop-filter', 'blur(8px)') // Frosted glass blur
      .style('-webkit-backdrop-filter', 'blur(20px)') // For Safari support
      .style('border', '1px solid rgba(255, 255, 255, 0.2)') // Subtle border
      .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)') // Subtle shadow
      .style('color', darkMode ? '#E5E7EB' : '#111827'); // Dynamic text color for readability
  
    const mainGroup = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
  
    const crosshairGroup = mainGroup.append("g")
      .attr("class", "crosshair")
      .style("display", showCrosshair ? "block" : "none");
  
    crosshairRef.current = crosshairGroup.node();
  
    const crosshairLine = crosshairGroup.append("line")
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)")
      .attr("stroke-width", 1)
      .style("pointer-events", "none");
  
    const crosshairLabel = crosshairGroup.append("text")
      .attr("y", -5)
      .attr("fill", darkMode ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)")
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("pointer-events", "none");
  
    svg.append("defs").append("clipPath")
      .attr("id", "clip")
      .append("rect")
      .attr("width", width)
      .attr("height", height);
  
    const xScaleMini = d3.scaleLinear()
      .domain(timeDomain)
      .range([0, width]);
  
    const xScaleMain = d3.scaleLinear()
      .domain([windowPosition, windowPosition + windowWidth])
      .range([0, width]);
  
    const yScaleMain = d3.scaleBand()
      .domain(taskNames)
      .range([0, height])
      .padding(0.2);
  
    const colorScale = d3.scaleOrdinal()
      .domain(taskNames)
      .range(taskNames.map(getTaskColor));
  
    const miniTimeline = svg.append("g")
      .attr("transform", `translate(${margin.left},${height + margin.top + spaceBetweenCharts})`);
    
    miniTimelineRef.current = miniTimeline.node();
  
    miniTimeline.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", miniTimelineHeight)
      .attr("fill", darkMode ? "#374151" : "#F3F4F6")
      .attr("rx", 4);
  
    const binSize = width / 200;
    const bins = new Array(Math.ceil(width / binSize)).fill(0);
    
    tasks.forEach(task => {
      const startBin = Math.floor(xScaleMini(task.startTime) / binSize);
      const endBin = Math.floor(xScaleMini(task.endTime) / binSize);
      for (let i = startBin; i <= endBin && i < bins.length; i++) {
        if (i >= 0) bins[i]++;
      }
    });
  
    const maxBinHeight = Math.max(...bins);
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
  
    const windowIndicator = miniTimeline.append("rect")
      .attr("class", "window-indicator")
      .attr("y", 0)
      .attr("height", miniTimelineHeight)
      .attr("fill", darkMode ? "#4B5563" : "#E5E7EB")
      .attr("fill-opacity", 0.3)
      .attr("stroke", darkMode ? "#6B7280" : "#9CA3AF")
      .attr("stroke-width", 2)
      .attr("rx", 4)
      .style("cursor", "grab");
  
    const updateWindowIndicator = () => {
      const x = xScaleMini(windowPosition);
      const width = xScaleMini(windowPosition + windowWidth) - x;
      windowIndicator
        .attr("x", x)
        .attr("width", width);
    };
  
    updateWindowIndicator();
  
    const drag = d3.drag<SVGRectElement, unknown>()
      .on("start", (event) => {
        d3.select(event.sourceEvent.target).style("cursor", "grabbing");
        const miniTimelineNode = miniTimelineRef.current;
        if (miniTimelineNode) {
          const point = d3.pointer(event.sourceEvent, miniTimelineNode);
          dragStartRef.current = {
            x: point[0],
            position: windowPosition
          };
        }
      })
      .on("drag", (event) => {
        if (dragStartRef.current && miniTimelineRef.current) {
          const point = d3.pointer(event.sourceEvent, miniTimelineRef.current);
          const dx = point[0] - dragStartRef.current.x;
          const newPosition = dragStartRef.current.position + xScaleMini.invert(dx) - xScaleMini.invert(0);
          const maxPosition = timeDomain[1] - windowWidth;
          setWindowPosition(Math.max(timeDomain[0], Math.min(maxPosition, newPosition)));
        }
      })
      .on("end", (event) => {
        d3.select(event.sourceEvent.target).style("cursor", "grab");
        dragStartRef.current = null;
      });
  
    windowIndicator.call(drag as any);
  
    const xAxis = d3.axisBottom(xScaleMain)
      .tickFormat(d => formatTime(d as number));
    
    const yAxis = d3.axisLeft(yScaleMain);
  
    const xAxisGroup = mainGroup.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .style("color", darkMode ? "#fff" : "#000");
  
    xAxisGroup.selectAll("text")
      .style("text-anchor", "end")
      .style("font-size", "12px")
      .attr("dx", "-.8em")
      .attr("dy", ".15em")
      .attr("transform", "rotate(-45)");
  
    const yAxisGroup = mainGroup.append("g")
      .attr("class", "y-axis")
      .call(yAxis)
      .style("color", darkMode ? "#fff" : "#000");
  
    yAxisGroup.selectAll("text")
      .style("font-size", "12px");
  
    const taskGroup = mainGroup.append("g")
      .attr("clip-path", "url(#clip)");
  
    const updateTasks = () => {
      const currentXScale = mainZoom.rescaleX(xScaleMain);
  
      const taskGroups = taskGroup.selectAll<SVGGElement, TaskData>("g.task")
        .data(visibleTasks, d => `${d.name}-${d.startTime}`);
  
      taskGroups.exit().remove();
  
      const newTaskGroups = taskGroups.enter()
        .append("g")
        .attr("class", "task");
  
      // Function to split a task into segments based on preemptions
      const getTaskSegments = (task: TaskData) => {
        const segments: { start: number, end: number, isPreempted: boolean }[] = [];
        
        if (!task.preemptions || task.preemptions.length === 0) {
          segments.push({ start: task.startTime, end: task.endTime, isPreempted: false });
          return segments;
        }
  
        const sortedPreemptions = [...task.preemptions].sort((a, b) => a.startTime - b.startTime);
        let currentTime = task.startTime;
  
        sortedPreemptions.forEach(preemption => {
          if (currentTime < preemption.startTime) {
            segments.push({
              start: currentTime,
              end: preemption.startTime,
              isPreempted: false
            });
          }
  
          segments.push({
            start: preemption.startTime,
            end: preemption.endTime,
            isPreempted: true
          });
  
          currentTime = preemption.endTime;
        });
  
        if (currentTime < task.endTime) {
          segments.push({
            start: currentTime,
            end: task.endTime,
            isPreempted: false
          });
        }
  
        return segments;
      };
  
      newTaskGroups.each(function(d) {
        const group = d3.select(this);
        const segments = getTaskSegments(d);
  
        segments.forEach(segment => {
          group.append("rect")
            .attr("class", segment.isPreempted ? "preemption-segment" : "normal-segment")
            .attr("x", currentXScale(segment.start))
            .attr("y", yScaleMain(d.name) || 0)
            .attr("width", Math.max(2, currentXScale(segment.end) - currentXScale(segment.start)))
            .attr("height", yScaleMain.bandwidth())
            .attr("fill", colorScale(d.name))
            .attr("fill-opacity", segment.isPreempted ? 0.3 : 0.5)
            .attr("stroke", colorScale(d.name))
            .attr("stroke-width", 1)
            .attr("rx", d.name === '_RTOS_' ? 4 : 2);
        });
      });
  
      taskGroups.each(function(d) {
        const group = d3.select(this);
        group.selectAll("rect").remove();
  
        const segments = getTaskSegments(d);
        segments.forEach(segment => {
          group.append("rect")
            .attr("class", segment.isPreempted ? "preemption-segment" : "normal-segment")
            .attr("x", currentXScale(segment.start))
            .attr("y", yScaleMain(d.name) || 0)
            .attr("width", Math.max(2, currentXScale(segment.end) - currentXScale(segment.start)))
            .attr("height", yScaleMain.bandwidth())
            .attr("fill", colorScale(d.name))
            .attr("fill-opacity", segment.isPreempted ? 0.3 : 0.5)
            .attr("stroke", colorScale(d.name))
            .attr("stroke-width", 1)
            .attr("rx", d.name === '_RTOS_' ? 4 : 2);
        });
      });
  
      const handleTaskInteraction = (event: any, d: TaskData) => {
        const group = d3.select(event.currentTarget);
        if (d !== selectedTask) {
          group.selectAll("rect.normal-segment")
            .attr("fill-opacity", 1);
        }
        
        const duration = ((d.endTime - d.startTime) / cpuFrequency * 1000).toFixed(3);
        let tooltipContent = `
          <div class="space-y-1">
            <div class="font-medium ${darkMode ? 'text-white' : 'text-gray-900'}">${d.name}</div>
            <div class="space-y-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}">
              <div>Duration: ${duration}ms</div>
              <div>Start: ${d.startTime}</div>
              <div>End: ${d.endTime}</div>
        `;
  
        if (d.preemptions && d.preemptions.length > 0) {
          tooltipContent += `
            <div class="mt-2">
              <div class="font-medium">Preemptions:</div>
              ${d.preemptions.map(p => `
                <div>${p.isrName}: runtime ${((p.endTime - p.startTime) / cpuFrequency * 1000).toFixed(3)}ms</div>
              `).join('')}
            </div>
          `;
        }
  
        tooltipContent += `</div></div>`;
        
        tooltipRef.current!.innerHTML = tooltipContent;
        tooltipRef.current!.style.visibility = 'visible';
        
        const mouse = d3.pointer(event, containerRef.current);
        tooltipRef.current!.style.left = `${mouse[0] + 10}px`;
        tooltipRef.current!.style.top = `${mouse[1] - 10}px`;
      };
  
      newTaskGroups
        .on("click", (event, d) => onTaskSelect(d))
        .on("mouseover", handleTaskInteraction)
        .on("mousemove", (event) => {
          const mouse = d3.pointer(event, containerRef.current);
          tooltipRef.current!.style.left = `${mouse[0] + 10}px`;
          tooltipRef.current!.style.top = `${mouse[1] - 10}px`;
        })
        .on("mouseout", function(event, d) {
          const group = d3.select(this);
          if (d !== selectedTask) {
            group.selectAll("rect.normal-segment")
              .attr("fill-opacity", 0.5);
          }
          tooltipRef.current!.style.visibility = 'hidden';
        });
  
      xAxisGroup.call(xAxis.scale(currentXScale));
    };
  
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 50])
      .extent([[0, 0], [width, height]])
      .on("zoom", (event) => {
        setMainZoom(event.transform);
        updateTasks();
      });
  
    svg.call(zoom);
    
    if (mainZoom !== d3.zoomIdentity) {
      svg.call(zoom.transform, mainZoom);
    }
  
    if (showCrosshair) {
      svg.on("mousemove", (event) => {
        const [x, y] = d3.pointer(event, mainGroup.node());
        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          const currentXScale = mainZoom.rescaleX(xScaleMain);
          const time = currentXScale.invert(x);
          
          crosshairLine.attr("x1", x).attr("x2", x);
          crosshairLabel
            .attr("x", x)
            .text(formatTime(time));
          
          crosshairGroup.style("display", "block");
        } else {
          crosshairGroup.style("display", "none");
        }
      });
  
      svg.on("mouseleave", () => {
        crosshairGroup.style("display", "none");
      });
    }
  
    svg.on("click", (event) => {
      if (event.target === svg.node()) {
        onTaskSelect(null);
      }
    });
  
    updateTasks();
  };

  useEffect(() => {
    createChart();
  }, [visibleTasks, cpuFrequency, darkMode, selectedTask, mainZoom, windowSize, windowPosition, showCrosshair]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && svgRef.current) {
        createChart();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [tasks, cpuFrequency, darkMode, selectedTask, mainZoom, windowSize, windowPosition, showCrosshair]);

  return (
    <div ref={containerRef} className="timeline-container w-full h-full glass-morphism rounded-md overflow-hidden">
      <svg
        ref={svgRef}
        className="w-full h-full"
      />
    </div>
  );
};

export default TaskTimeline;