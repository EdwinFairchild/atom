import { TaskData } from '../types';

function sortTaskName(a: string, b: string): number {
  // Special handling for IDLE and _RTOS_ tasks
  if (a === '_RTOS_') return 1;
  if (b === '_RTOS_') return -1;
  if (a === 'IDLE') return b === '_RTOS_' ? -1 : 1;
  if (b === 'IDLE') return a === '_RTOS_' ? 1 : -1;
  return a.localeCompare(b);
}

export function parseLogFile(content: string): TaskData[] {
  const tasks: TaskData[] = [];
  const regex = /<ITM>([SE])\|([0-9A-F]+)\|([^<]+)<END>/g;
  let match;
  let lastEndTime: number | null = null;
  let lastTaskName: string | null = null;

  const taskStarts = new Map<string, number>();

  while ((match = regex.exec(content)) !== null) {
    const [, type, timestamp, taskName] = match;
    const time = parseInt(timestamp, 16);

    // Add RTOS task switch if there's a gap between tasks
    if (lastEndTime !== null && type === 'S') {
      const gap = time - lastEndTime;
      if (gap > 0) {
        tasks.push({
          name: "_RTOS_",
          startTime: lastEndTime,
          endTime: time
        });
      }
    }

    if (type === 'S') {
      taskStarts.set(taskName, time);
      lastTaskName = taskName;
    } else if (type === 'E') {
      const startTime = taskStarts.get(taskName);
      if (startTime !== undefined) {
        tasks.push({
          name: taskName,
          startTime,
          endTime: time
        });
        taskStarts.delete(taskName);
        lastEndTime = time;
      }
    }
  }

  // Sort tasks by start time
  tasks.sort((a, b) => a.startTime - b.startTime);

  return tasks;
}