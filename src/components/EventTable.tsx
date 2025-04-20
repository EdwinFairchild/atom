import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { FixedSizeList as List, ListOnScrollProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { TaskData } from '../types'; // Ensure types.ts uses bigint

interface Event {
  timestamp: bigint;
  type: string; // 'S' (Start), 'E' (End), 'ISR', 'CRT' (Create)
  duration: number; // Duration in seconds (float)
  info: string; // Task name or ISR name
  originalTask: TaskData; // Reference to the original task for selection
}

interface EventTableProps {
  tasks: TaskData[]; // Receive all tasks
  cpuFrequency: number;
  darkMode: boolean;
  onEventSelect: (task: TaskData, shouldScroll?: boolean) => void;
}

const ROW_HEIGHT = 48; // px
const HEADER_HEIGHT = 40; // px

const EventTable: React.FC<EventTableProps> = ({ tasks, cpuFrequency, darkMode, onEventSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const listRef = useRef<List>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Format time: Convert bigint cycles to seconds string
  const formatTime = (cycles: bigint): string => {
    if (typeof cycles !== 'bigint') return 'N/A';
    // Convert bigint to Number for division. May lose precision for huge values.
    return (Number(cycles) / cpuFrequency).toFixed(6);
  };

  // Generate events from tasks, handling bigint times
  const events = useMemo(() => {
    const eventList: Event[] = [];

    tasks.forEach(task => {
      // Determine event type and info based on task name
      let eventType: string;
      let eventInfo: string;
      let durationSeconds = 0;

      if (task.name.startsWith('ISR:')) {
        eventType = 'ISR';
        eventInfo = task.name.substring(4); // Get ISR name after "ISR:"
        // Calculate duration for ISR events
        if (task.endTime > task.startTime) {
            durationSeconds = Number(task.endTime - task.startTime) / cpuFrequency;
        }
      } else if (task.name.startsWith('RTOS:Create')) {
          eventType = 'CRT'; // Create event
          eventInfo = task.name.substring(12); // Get task name after "RTOS:Create "
          // Create events are instantaneous in this model
      } else if (task.name === '_RTOS_') {
          eventType = 'RTOS'; // Generic RTOS/Idle time
          eventInfo = 'OS/Idle';
          if (task.endTime > task.startTime) {
              durationSeconds = Number(task.endTime - task.startTime) / cpuFrequency;
          }
      } else {
          // Regular Task Start event
          eventType = 'S';
          eventInfo = task.name;
          if (task.endTime > task.startTime) {
              durationSeconds = Number(task.endTime - task.startTime) / cpuFrequency;
          }
      }

      // Add the primary event (Start, ISR, Create, RTOS)
      eventList.push({
        timestamp: task.startTime,
        type: eventType,
        duration: durationSeconds,
        info: eventInfo,
        originalTask: task, // Keep reference
      });

      // Add Task End event only for regular tasks (not ISRs, Creates, RTOS gaps)
      if (!task.name.startsWith('ISR:') && !task.name.startsWith('RTOS:') && task.name !== '_RTOS_') {
        eventList.push({
          timestamp: task.endTime,
          type: 'E',
          duration: 0, // End events have no duration
          info: task.name,
          originalTask: task, // Keep reference
        });
      }

      // Add events for Preemptions within a task slice
      if (task.preemptions && task.preemptions.length > 0) {
        task.preemptions.forEach(preemption => {
          let pDurationSeconds = 0;
          if (preemption.endTime > preemption.startTime) {
              pDurationSeconds = Number(preemption.endTime - preemption.startTime) / cpuFrequency;
          }
          eventList.push({
            timestamp: preemption.startTime,
            type: 'ISR', // Preemptions are ISRs
            duration: pDurationSeconds,
            info: `${preemption.isrName} (preempts ${task.name})`,
            originalTask: task, // Reference the preempted task
          });
        });
      }
    });

    // Sort all generated events by timestamp (bigint comparison works)
    return eventList.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }, [tasks, cpuFrequency]);

  // Filter events based on search term
  const filteredEvents = useMemo(() => {
    if (!searchTerm) return events;
    const term = searchTerm.toLowerCase();
    return events.filter(event =>
      event.type.toLowerCase().includes(term) ||
      event.info.toLowerCase().includes(term) ||
      formatTime(event.timestamp).includes(term) || // Search formatted time string
      event.duration.toFixed(6).includes(term)
    );
  }, [events, searchTerm, cpuFrequency]); // Include cpuFrequency due to formatTime usage

  // Row renderer for the virtualized list
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const event = filteredEvents[index];
    if (!event) return null; // Should not happen, but safety check

    // Determine background color based on event type
    let typeBgColor = '';
    let typeTextColor = '';
    switch (event.type) {
        case 'ISR':
            typeBgColor = darkMode ? 'bg-purple-900' : 'bg-purple-100';
            typeTextColor = darkMode ? 'text-purple-200' : 'text-purple-800';
            break;
        case 'S':
            typeBgColor = darkMode ? 'bg-green-900' : 'bg-green-100';
            typeTextColor = darkMode ? 'text-green-200' : 'text-green-800';
            break;
        case 'E':
            typeBgColor = darkMode ? 'bg-red-900' : 'bg-red-100';
            typeTextColor = darkMode ? 'text-red-200' : 'text-red-800';
            break;
        case 'CRT':
            typeBgColor = darkMode ? 'bg-yellow-900' : 'bg-yellow-100';
            typeTextColor = darkMode ? 'text-yellow-200' : 'text-yellow-800';
            break;
        case 'RTOS':
            typeBgColor = darkMode ? 'bg-gray-700' : 'bg-gray-200';
            typeTextColor = darkMode ? 'text-gray-300' : 'text-gray-600';
            break;
        default:
            typeBgColor = darkMode ? 'bg-gray-600' : 'bg-gray-300';
            typeTextColor = darkMode ? 'text-gray-100' : 'text-gray-800';
    }


    return (
      <div
        style={style}
        onClick={() => {
          // Pass the original TaskData object associated with the event
          onEventSelect(event.originalTask, true); // Request scroll to task
        }}
        className={`flex items-center border-b border-gray-200 dark:border-gray-700 cursor-pointer
                   hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors text-sm`} // Reduced font size slightly
      >
        {/* Timestamp Column */}
        <div className="flex-shrink-0 w-[160px] px-3 py-2 font-mono text-gray-900 dark:text-gray-200 truncate">
          {formatTime(event.timestamp)}
        </div>
        {/* Type Column */}
        <div className="flex-shrink-0 w-[80px] px-3 py-2 text-center">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBgColor} ${typeTextColor}`}>
            {event.type}
          </span>
        </div>
        {/* Duration Column */}
        <div className="flex-shrink-0 w-[120px] px-3 py-2 font-mono text-gray-900 dark:text-gray-200 truncate">
          {event.duration > 0 ? event.duration.toFixed(6) : '-'}
        </div>
        {/* Info Column */}
        <div className="flex-1 min-w-[150px] px-3 py-2 text-gray-800 dark:text-gray-100 truncate">
          {event.info}
        </div>
      </div>
    );
  };

   // Handle scroll to keep track of position for AutoSizer optimization
   const handleScroll = ({ scrollOffset }: ListOnScrollProps) => {
       setScrollTop(scrollOffset);
   };

   // Reset scroll position when search term changes or data reloads
   useEffect(() => {
       if (listRef.current) {
           listRef.current.scrollTo(0);
       }
   }, [searchTerm, filteredEvents.length]); // Reset on filter change or data length change


  return (
    <div className="h-full flex flex-col glass-morphism rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
      {/* Search Bar */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
          <input
            type="text"
            placeholder="Search events (time, type, info, duration)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-1.5 rounded-md bg-white/10 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600
                     focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400
                     text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm"
          />
        </div>
      </div>

      {/* Header Row */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 z-10 flex-shrink-0" style={{ height: `${HEADER_HEIGHT}px` }}>
        <div className="flex-shrink-0 w-[160px] px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold text-xs uppercase tracking-wider">Timestamp (s)</div>
        <div className="flex-shrink-0 w-[80px] px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold text-xs uppercase tracking-wider text-center">Type</div>
        <div className="flex-shrink-0 w-[120px] px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold text-xs uppercase tracking-wider">Duration (s)</div>
        <div className="flex-1 min-w-[150px] px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold text-xs uppercase tracking-wider">Info</div>
      </div>

      {/* Virtualized List Area */}
      <div className="flex-1 w-full"> {/* Ensure this takes remaining space */}
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              height={height}
              itemCount={filteredEvents.length}
              itemSize={ROW_HEIGHT}
              width={width}
              onScroll={handleScroll}
              initialScrollOffset={scrollTop} // Restore scroll position
              className="scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent" // Custom scrollbar styling
            >
              {Row}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default EventTable;