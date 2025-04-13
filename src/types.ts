export interface TaskData {
  name: string;
  startTime: number;
  endTime: number;
  preemptions?: Array<{
    startTime: number;
    endTime: number;
    isrName: string;
  }>;
}