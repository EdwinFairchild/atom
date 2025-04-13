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
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, windowSize);
  }, [tasks, windowPosition, windowWidth, windowSize]);

  const taskNames = useMemo(() => {
    return Array.from(new Set(tasks.map(t => t.name))).sort((a, b) => {
      if (a === '_RTOS_') return 1;
      if (b === '_RTOS_') return -1;
      if (a === 'IDLE') return b === '_RTOS_' ? -1 : 1;
      if (b === 'IDLE') return a === '_RTOS_' ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [tasks]);

  const formatTime = (cycles: number) => {
    const seconds = cycles / cpuFrequency;
    return seconds.toFixed(3) + 's';
  };

  const fitToView = () => {
    if (!svgRef.current || !tasks.length || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const margin = { top: 20, right: 30, bottom: 120, left: 120 };
    const width = containerRef.current.clientWidth - margin.left - margin.right;
    
    svg.transition()
      .duration(750)
      .call(zoomRef.current.transform, d3.zoomIdentity);
    
    setMainZoom(d3.zoomIdentity);
  };

  if (containerRef.current) {
    (containerRef.current as any).fitToView = fitToView;
  }

  useEffect(() => {
    if (tooltipRef.current) {
      tooltipRef.current.style.backgroundColor = darkMode ? '#374151' : '#ffffff';
      tooltipRef.current.style.border = `1px solid ${darkMode ? '#4B5563' : '#E5E7EB'}`;
      tooltipRef.current.style.color = darkMode ? '#ffffff' : '#111827';
    }
  }, [darkMode]);

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

    if (!tooltipRef.current) {
      tooltipRef.current = d3.select(containerRef.current)
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('background-color', darkMode ? '#374151' : '#ffffff')
        .style('border', `1px solid ${darkMode ? '#4B5563' : '#E5E7EB'}`)
        .style('border-radius', '0.375rem')
        .style('padding', '0.75rem')
        .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)')
        .style('pointer-events', 'none')
        .style('z-index', '50')
        .style('min-width', '200px')
        .style('font-size', '14px')
        .node() as HTMLDivElement;
    }

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
      .range(taskNames.map(name => {
        if (name === '_RTOS_') return '#FF4444';
        if (name === 'IDLE') return '#9CA3AF';
        return d3.schemeCategory10[taskNames.indexOf(name) % 10];
      }));

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

      const rects = taskGroup.selectAll<SVGRectElement, TaskData>("rect")
        .data(visibleTasks, d => `${d.name}-${d.startTime}`);

      rects.exit().remove();

      rects
        .attr("x", d => currentXScale(d.startTime))
        .attr("width", d => Math.max(2, currentXScale(d.endTime) - currentXScale(d.startTime)));

      rects.enter()
        .append("rect")
        .attr("x", d => currentXScale(d.startTime))
        .attr("y", d => yScaleMain(d.name) || 0)
        .attr("width", d => Math.max(2, currentXScale(d.endTime) - currentXScale(d.startTime)))
        .attr("height", yScaleMain.bandwidth())
        .attr("fill", d => colorScale(d.name))
        .attr("opacity", d => {
          if (selectedTask && d === selectedTask) return 1;
          return d.name === '_RTOS_' ? 0.6 : 0.8;
        })
        .attr("rx", d => d.name === '_RTOS_' ? 4 : 2)
        .attr("stroke", d => {
          if (selectedTask && d === selectedTask) return darkMode ? "#fff" : "#000";
          return "none";
        })
        .attr("stroke-width", d => selectedTask && d === selectedTask ? 1 : 0)
        .on("click", (event, d) => {
          onTaskSelect(d);
        })
        .on("mouseover", function(event, d) {
          const rect = d3.select(this);
          if (d !== selectedTask) {
            rect.attr("opacity", 1)
              .attr("stroke", darkMode ? "#fff" : "#000")
              .attr("stroke-width", 1);
          }
          
          const duration = ((d.endTime - d.startTime) / cpuFrequency * 1000).toFixed(3);
          tooltipRef.current!.innerHTML = `
            <div class="space-y-1">
              <div class="font-medium ${darkMode ? 'text-white' : 'text-gray-900'}">${d.name}</div>
              <div class="space-y-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}">
                <div>Duration: ${duration}ms</div>
                <div>Start: ${d.startTime}</div>
                <div>End: ${d.endTime}</div>
              </div>
            </div>
          `;
          tooltipRef.current!.style.visibility = 'visible';
          
          const mouse = d3.pointer(event, containerRef.current);
          tooltipRef.current!.style.left = `${mouse[0] + 10}px`;
          tooltipRef.current!.style.top = `${mouse[1] - 10}px`;
        })
        .on("mousemove", (event) => {
          const mouse = d3.pointer(event, containerRef.current);
          tooltipRef.current!.style.left = `${mouse[0] + 10}px`;
          tooltipRef.current!.style.top = `${mouse[1] - 10}px`;
        })
        .on("mouseout", function(event, d) {
          const rect = d3.select(this);
          if (d !== selectedTask) {
            rect.attr("opacity", d.name === '_RTOS_' ? 0.6 : 0.8)
              .attr("stroke", "none");
          }
          tooltipRef.current!.style.visibility = 'hidden';
        });

      xAxisGroup.call(xAxis.scale(currentXScale));
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 5000])
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