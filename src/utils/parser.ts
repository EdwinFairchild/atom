import { TaskData, TaskStats } from '../types';

function sortTaskName(a: string, b: string): number {
  // Special handling for IDLE, _RTOS_, and ISR tasks
  if (a === '_RTOS_' || a.startsWith('RTOS:')) return 1;
  if (b === '_RTOS_' || b.startsWith('RTOS:')) return -1;
  if (a === 'IDLE') return b === '_RTOS_' || b.startsWith('RTOS:') ? -1 : 1;
  if (b === 'IDLE') return a === '_RTOS_' || a.startsWith('RTOS:') ? 1 : -1;
  if (a.startsWith('ISR:')) return 1;
  if (b.startsWith('ISR:')) return -1;
  return a.localeCompare(b);
}

function calculateTaskStats(tasks: TaskData[]): void {
  // Get total timeline duration
  const timelineStart = tasks.reduce((min, t) => t.startTime < min ? t.startTime : min, tasks[0].startTime);
  const timelineEnd = tasks.reduce((max, t) => t.endTime > max ? t.endTime : max, tasks[0].endTime);
  const totalTimelineDuration = timelineEnd - timelineStart;

  // Check for invalid duration
  if (totalTimelineDuration <= BigInt(0)) {
    console.error("Invalid timeline duration calculated");
    tasks.forEach(task => {
      task.stats = {
        totalRunTime: BigInt(0),
        actualRunTime: BigInt(0),
        runCount: 0,
        cpuLoad: 0,
        averageRunTime: BigInt(0),
        preemptionCount: 0,
        totalPreemptionTime: BigInt(0)
      };
    });
    return;
  }

  // Group tasks by name to calculate statistics
  const taskGroups = new Map<string, TaskData[]>();
  tasks.forEach(task => {
    const existing = taskGroups.get(task.name) || [];
    existing.push(task);
    taskGroups.set(task.name, existing);
  });

  // Calculate stats for each task group
  taskGroups.forEach((taskInstances, taskName) => {
    let totalRunTime = BigInt(0);
    let actualRunTime = BigInt(0);
    let totalPreemptionTime = BigInt(0);
    let preemptionCount = 0;

    taskInstances.forEach(task => {
      const duration = task.endTime >= task.startTime ? task.endTime - task.startTime : BigInt(0);
      totalRunTime += duration;

      let preemptionTimeForThisSlice = BigInt(0);
      if (task.preemptions && task.preemptions.length > 0) {
        preemptionCount += task.preemptions.length;
        preemptionTimeForThisSlice = task.preemptions.reduce((acc, p) => {
          const pDuration = p.endTime > p.startTime ? p.endTime - p.startTime : BigInt(0);
          return acc + pDuration;
        }, BigInt(0));

        preemptionTimeForThisSlice = preemptionTimeForThisSlice > duration ? duration : preemptionTimeForThisSlice;
        totalPreemptionTime += preemptionTimeForThisSlice;
      }
      actualRunTime += duration - preemptionTimeForThisSlice;
    });

    // Calculate CPU load using BigInt arithmetic and convert to number at the end
    const cpuLoad = Number((actualRunTime * BigInt(10000) / totalTimelineDuration)) / 100;

    const stats: TaskStats = {
      totalRunTime,
      actualRunTime,
      runCount: taskInstances.length,
      cpuLoad: Math.max(0, Math.min(100, cpuLoad)),
      averageRunTime: taskInstances.length > 0 ? actualRunTime / BigInt(taskInstances.length) : BigInt(0),
      preemptionCount,
      totalPreemptionTime
    };

    taskInstances.forEach(task => {
      task.stats = stats;
    });
  });
  let totalCalculatedLoad = 0;
  taskGroups.forEach((instances) => { // Iterate through the map values (arrays of task instances)
      // All instances for a task have the same stats object reference.
      // Get stats from the first instance (if the group is not empty).
      if (instances.length > 0 && instances[0].stats) {
          totalCalculatedLoad += instances[0].stats.cpuLoad;
      }
  });
  console.log("Sum of all calculated CPU loads:", totalCalculatedLoad.toFixed(2), "%"); // Format for readability
}

export function parseLogFile(content: string): TaskData[] {
  const tasks: TaskData[] = [];
  const regex = /<ITM>(TC|S|E|ISR)\|([0-9A-F]+)\|([^|<]+)(?:\|([^<]+))?(?:\|([^<]+))?<END>/g;
  let match;
  let lastEndTime: bigint | null = null;
  let lastTaskName: string | null = null;

  const taskStarts = new Map<string, bigint>();
  const isrStarts = new Map<string, bigint>();
  const activeTask = { name: '', startTime: BigInt(0), preemptions: [] };

  // Constants for overflow detection
  const OVERFLOW_THRESHOLD = BigInt("0xF0000000"); // Near the 32-bit boundary
  let currentOverflowCount = BigInt(0);
  let lastTimestamp = BigInt(0);

  const parseTimestamp = (hexTimestamp: string): bigint => {
    const rawTimestamp = BigInt(`0x${hexTimestamp}`);
    
    // Check for potential overflow
    if (lastTimestamp > OVERFLOW_THRESHOLD && rawTimestamp < BigInt("0x10000000")) {
      // We've detected an overflow, but SysTick hasn't updated the counter yet
      // Use the current overflow count + 1
      return rawTimestamp + ((currentOverflowCount + BigInt(1)) << BigInt(32));
    } else if (lastTimestamp <= OVERFLOW_THRESHOLD && rawTimestamp > OVERFLOW_THRESHOLD) {
      // Normal timestamp, no overflow
      return rawTimestamp + (currentOverflowCount << BigInt(32));
    } else if (rawTimestamp < lastTimestamp && rawTimestamp < BigInt("0x10000000")) {
      // We've detected that SysTick has updated the counter
      currentOverflowCount++;
      return rawTimestamp + (currentOverflowCount << BigInt(32));
    }
    
    // Normal case - no overflow
    return rawTimestamp + (currentOverflowCount << BigInt(32));
  };

  while ((match = regex.exec(content)) !== null) {
    const [, type, timestamp, name, param1, param2] = match;
    const time = parseTimestamp(timestamp);
    lastTimestamp = time;

    // Handle ISR events
    if (type === 'ISR') {
      const isrName = name;
      const isrState = param1;

      if (isrState === 'START') {
        isrStarts.set(isrName, time);
        if (activeTask.name && !activeTask.name.startsWith('ISR:')) {
          activeTask.preemptions.push({
            startTime: time,
            endTime: BigInt(0),
            isrName
          });
        }
      } else if (isrState === 'END') {
        const startTime = isrStarts.get(isrName);
        if (startTime !== undefined) {
          tasks.push({
            name: `ISR:${isrName}`,
            startTime,
            endTime: time
          });
          
          if (activeTask.name && activeTask.preemptions.length > 0) {
            const lastPreemption = activeTask.preemptions[activeTask.preemptions.length - 1];
            if (lastPreemption.isrName === isrName && lastPreemption.endTime === BigInt(0)) {
              lastPreemption.endTime = time;
            }
          }
          
          isrStarts.delete(isrName);
        }
      }
      continue;
    }

    if (lastEndTime !== null && (type === 'S' || type === 'TC')) {
      const gap = time - lastEndTime;
      if (gap > BigInt(0)) {
        tasks.push({
          name: type === 'TC' ? `RTOS:Create ${name}` : '_RTOS_',
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

  // Sort tasks by start time using BigInt comparison
  tasks.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));

  calculateTaskStats(tasks);

  return tasks;
}