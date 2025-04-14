export interface TaskStats {
  totalRunTime: number;          // Including preemptions
  actualRunTime: number;         // Excluding preemptions
  runCount: number;              // Number of times this task has run
  cpuLoad: number;              // CPU load percentage
  averageRunTime: number;        // Average runtime per execution
  preemptionCount: number;       // Number of times task was preempted
  totalPreemptionTime: number;   // Total time spent in preemptions
}

export interface TaskData {
  name: string;
  startTime: number;
  endTime: number;
  preemptions?: Array<{
    startTime: number;
    endTime: number;
    isrName: string;
  }>;
  stats?: TaskStats;
}

// Define the Preemption type explicitly for clarity and reuse
export interface Preemption {
  startTime: bigint;    // Use bigint for preemption timestamps
  endTime: bigint;      // Use bigint for preemption timestamps
  isrName: string;
}
