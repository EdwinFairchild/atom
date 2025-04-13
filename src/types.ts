export interface TaskData {
  name: string;
  startTime: number;
  endTime: number;
  type: 'task' | 'interrupt' | 'delay';
}