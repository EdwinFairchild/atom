import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { TaskData } from '../types';

interface Event {
  timestamp: number;
  type: string;
  duration: number;
  info: string;
}

interface EventTableProps {
  tasks: TaskData[];
  cpuFrequency: number;
  darkMode: boolean;
  onEventSelect: (task: TaskData, shouldScroll?: boolean) => void;
}

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;

const EventTable: React.FC<EventTableProps> = ({ tasks, cpuFrequency, darkMode, onEventSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const events = useMemo(() => {
    const eventList: Event[] = [];

    tasks.forEach(task => {
      // Add task start
      eventList.push({
        timestamp: task.startTime,
        type: task.name.startsWith('ISR:') ? 'ISR' : 'S',
        duration: (task.endTime - task.startTime) / cpuFrequency,
        info: task.name.startsWith('ISR:') ? task.name.split(':')[1] : task.name
      });

      // Add task end if not an ISR
      if (!task.name.startsWith('ISR:')) {
        eventList.push({
          timestamp: task.endTime,
          type: 'E',
          duration: 0,
          info: task.name
        });
      }

      // Add preemptions
      if (task.preemptions) {
        task.preemptions.forEach(preemption => {
          eventList.push({
            timestamp: preemption.startTime,
            type: 'ISR',
            duration: (preemption.endTime - preemption.startTime) / cpuFrequency,
            info: `${preemption.isrName} (preempted ${task.name})`
          });
        });
      }
    });

    return eventList.sort((a, b) => a.timestamp - b.timestamp);
  }, [tasks, cpuFrequency]);

  const filteredEvents = useMemo(() => {
    if (!searchTerm) return events;
    const term = searchTerm.toLowerCase();
    return events.filter(event => 
      event.type.toLowerCase().includes(term) ||
      event.info.toLowerCase().includes(term) ||
      (event.timestamp / cpuFrequency).toFixed(6).includes(term) ||
      event.duration.toFixed(6).includes(term)
    );
  }, [events, searchTerm, cpuFrequency]);

  const formatTime = (cycles: number) => {
    return (cycles / cpuFrequency).toFixed(6);
  };

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const event = filteredEvents[index];
    return (
      <div
        style={style}
        onClick={() => {
          const task = tasks.find(t => 
            (t.startTime === event.timestamp && t.name === event.info) ||
            (t.endTime === event.timestamp && t.name === event.info) ||
            (t.preemptions?.some(p => p.startTime === event.timestamp))
          );
          if (task) onEventSelect(task, true);
        }}
        className={`flex items-center border-b border-gray-200 dark:border-gray-700 cursor-pointer
                   hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors`}
      >
        <div className="flex-1 min-w-[180px] p-4 font-mono text-gray-900 dark:text-white">
          {formatTime(event.timestamp)}
        </div>
        <div className="flex-1 min-w-[100px] p-4">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
            ${event.type === 'ISR' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
              event.type === 'S' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
              'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
            {event.type}
          </span>
        </div>
        <div className="flex-1 min-w-[120px] p-4 font-mono text-gray-900 dark:text-white">
          {event.duration.toFixed(6)}
        </div>
        <div className="flex-1 min-w-[200px] p-4 text-gray-900 dark:text-white">
          {event.info}
        </div>
      </div>
    );
  };

  return (
    <div className="h-[30vh] flex flex-col glass-morphism">
      {/* Search Bar */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={20} />
          <input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md bg-white/10 border border-gray-200 dark:border-gray-700 
                     focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                     text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
      </div>

      {/* Header */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 z-10">
        <div className="flex-1 min-w-[180px] p-4 text-gray-900 dark:text-white font-semibold">Timestamp (s)</div>
        <div className="flex-1 min-w-[100px] p-4 text-gray-900 dark:text-white font-semibold">Type</div>
        <div className="flex-1 min-w-[120px] p-4 text-gray-900 dark:text-white font-semibold">Duration (s)</div>
        <div className="flex-1 min-w-[200px] p-4 text-gray-900 dark:text-white font-semibold">Info</div>
      </div>

      {/* Virtualized List */}
      <div className="flex-1">
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              itemCount={filteredEvents.length}
              itemSize={ROW_HEIGHT}
              width={width}
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