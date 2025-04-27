export interface TaskStats {
  totalRunTime: bigint;          // Including preemptions
  actualRunTime: bigint;         // Excluding preemptions
  runCount: number;              // Number of times this task has run
  cpuLoad: number;              // CPU load percentage
  averageRunTime: bigint;        // Average runtime per execution
  preemptionCount: number;       // Number of times task was preempted
  totalPreemptionTime: bigint;   // Total time spent in preemptions
}

export interface TaskData {
  name: string;
  startTime: bigint;
  endTime: bigint;
  preemptions?: Array<{
    startTime: bigint;
    endTime: bigint;
    isrName: string;
  }>;
  stats?: TaskStats;
}

// Define the Preemption type explicitly for clarity and reuse
export interface Preemption {
  startTime: bigint;
  endTime: bigint;
  isrName: string;
}