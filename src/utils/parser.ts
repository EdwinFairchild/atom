import { TaskData, TaskStats } from '../types';

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

function calculateTaskStats(tasks: TaskData[]): void {
  // Get total timeline duration
  const timelineStart = Math.min(...tasks.map(t => t.startTime));
  const timelineEnd = Math.max(...tasks.map(t => t.endTime));
  const totalTimelineDuration = timelineEnd - timelineStart;

  // Check for invalid duration
  if (totalTimelineDuration <= 0) {
    console.error("Invalid timeline duration calculated:", totalTimelineDuration, "Start:", timelineStart, "End:", timelineEnd);
    // Assign default stats or handle error appropriately
    tasks.forEach(task => {
      task.stats = {
        totalRunTime: 0,
        actualRunTime: 0,
        runCount: 0,
        cpuLoad: 0,
        averageRunTime: 0,
        preemptionCount: 0,
        totalPreemptionTime: 0
      };
    });
    return; // Avoid division by zero or non-sensical calculations
  }

  // Group tasks by name to calculate statistics
  const taskGroups = new Map<string, TaskData[]>();
  tasks.forEach(task => {
    const existing = taskGroups.get(task.name) || [];
    existing.push(task);
    taskGroups.set(task.name, existing);
  });

  // Calculate stats for each task group
  taskGroups.forEach((taskInstances, taskName) => { // taskInstances is defined HERE
    let totalRunTime = 0;
    let actualRunTime = 0; // Net run time (excluding time spent in preempting ISRs)
    let totalPreemptionTime = 0; // Time *this* task was preempted by ISRs
    let preemptionCount = 0;

    taskInstances.forEach(task => {
      // Ensure endTime is not before startTime
      const duration = task.endTime >= task.startTime ? task.endTime - task.startTime : 0;
      totalRunTime += duration;

      let preemptionTimeForThisSlice = 0;
      if (task.preemptions && task.preemptions.length > 0) {
        preemptionCount += task.preemptions.length;
        preemptionTimeForThisSlice = task.preemptions.reduce((acc, p) => {
          // Ensure valid preemption times
          const pDuration = p.endTime > p.startTime ? p.endTime - p.startTime : 0;
          return acc + pDuration;
        }, 0);

        // Sanity check: preemption time shouldn't exceed the task slice duration
        preemptionTimeForThisSlice = Math.min(preemptionTimeForThisSlice, duration);
        totalPreemptionTime += preemptionTimeForThisSlice;
      }
      // Actual run time is the slice duration minus any time an ISR ran during that slice
      actualRunTime += Math.max(0, duration - preemptionTimeForThisSlice); // Ensure non-negative
    });

    // *** CORRECTED CPU LOAD CALCULATION ***
    // Use actualRunTime for all task types as the numerator,
    // representing the net time the CPU spent on behalf of this task/state.
    // Use totalTimelineDuration as the consistent denominator.
    const cpuLoad = (actualRunTime / totalTimelineDuration) * 100;

    const stats: TaskStats = {
      totalRunTime, // Gross time slices assigned to the task
      actualRunTime, // Net time CPU executed task code (excluding ISR preemptions)
      runCount: taskInstances.length,
      cpuLoad: Math.max(0, Math.min(100, cpuLoad)), // Clamp between 0 and 100
      averageRunTime: taskInstances.length > 0 ? actualRunTime / taskInstances.length : 0,
      preemptionCount,
      totalPreemptionTime // Total time this task was paused due to ISRs
    };

    // Apply the calculated stats object to all instances of this task
    taskInstances.forEach(task => {
      task.stats = stats; // Assign the *same* stats object reference
    });
  }); // End of taskGroups.forEach loop


  // *** CORRECTED Summation Logic ***
  // Log the sum of all calculated CPU loads for verification.
  // Iterate over the calculated groups, not the original tasks array,
  // to easily get the unique stats for each task name.
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

  // Calculate statistics for all tasks
  calculateTaskStats(tasks);

  return tasks;
}