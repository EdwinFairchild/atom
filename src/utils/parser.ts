import { TaskData } from '../types';

function sortTaskName(a: string, b: string): number {
  // Special handling for IDLE, _RTOS_, and ISR tasks
  if (a === '_RTOS_') return 1;
  if (b === '_RTOS_') return -1;
  if (a === 'IDLE') return b === '_RTOS_' ? -1 : 1;
  if (b === 'IDLE') return a === '_RTOS_' ? 1 : -1;
  if (a.startsWith('ISR:')) return 1;
  if (b.startsWith('ISR:')) return -1;
  return a.localeCompare(b);
}

export function parseLogFile(content: string): TaskData[] {
  const tasks: TaskData[] = [];
  const regex = /<ITM>(TC|S|E|ISR)\|([0-9A-F]+)\|([^|<]+)(?:\|([^<]+))?(?:\|([^<]+))?<END>/g;
  let match;
  let lastEndTime: number | null = null;
  let lastTaskName: string | null = null;

  const taskStarts = new Map<string, number>();
  const isrStarts = new Map<string, number>();
  const activeTask = { name: '', startTime: 0, preemptions: [] };

  while ((match = regex.exec(content)) !== null) {
    const [, type, timestamp, name, param1, param2] = match;
    const time = parseInt(timestamp, 16);

    // Handle ISR events
    if (type === 'ISR') {
      const isrName = name;
      const isrState = param1;

      if (isrState === 'START') {
        isrStarts.set(isrName, time);
        // If there's an active task, record the ISR preemption
        if (activeTask.name && !activeTask.name.startsWith('ISR:')) {
          activeTask.preemptions.push({
            startTime: time,
            endTime: 0, // Will be set when ISR ends
            isrName
          });
        }
      } else if (isrState === 'END') {
        const startTime = isrStarts.get(isrName);
        if (startTime !== undefined) {
          // Add ISR task
          tasks.push({
            name: `ISR:${isrName}`,
            startTime,
            endTime: time
          });
          
          // Update preemption end time if there's an active task
          if (activeTask.name && activeTask.preemptions.length > 0) {
            const lastPreemption = activeTask.preemptions[activeTask.preemptions.length - 1];
            if (lastPreemption.isrName === isrName && lastPreemption.endTime === 0) {
              lastPreemption.endTime = time;
            }
          }
          
          isrStarts.delete(isrName);
        }
      }
      continue;
    }

    // Add RTOS task switch if there's a gap between tasks
    if (lastEndTime !== null && (type === 'S' || type === 'TC')) {
      const gap = time - lastEndTime;
      if (gap > 0) {
        tasks.push({
          name: "_RTOS_",
          startTime: lastEndTime,
          endTime: time
        });
      }
    }

    if (type === 'S' || type === 'TC') {
      taskStarts.set(name, time);
      activeTask.name = name;
      activeTask.startTime = time;
      activeTask.preemptions = [];
      lastTaskName = name;
    } else if (type === 'E') {
      const startTime = taskStarts.get(name);
      if (startTime !== undefined) {
        tasks.push({
          name,
          startTime,
          endTime: time,
          preemptions: [...activeTask.preemptions]
        });
        taskStarts.delete(name);
        lastEndTime = time;
        activeTask.name = '';
        activeTask.preemptions = [];
      }
    }
  }

  // Sort tasks by start time
  tasks.sort((a, b) => a.startTime - b.startTime);

  return tasks;
}