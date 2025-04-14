import React from 'react';
import { TaskData } from '../types';
import { Activity, Clock, ArrowRight, Cpu, BarChart } from 'lucide-react';

interface TaskDetailsProps {
  task: TaskData | null;
  cpuFrequency: number;
  darkMode: boolean;
}

const TaskDetails: React.FC<TaskDetailsProps> = ({ task, cpuFrequency, darkMode }) => {
  if (!task) {
    return (
      <div className="w-80 glass-morphism p-6">
        <div className="text-center text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Select a task to view details</p>
        </div>
      </div>
    );
  }

  const duration = (task.endTime - task.startTime) / cpuFrequency;
  const isRTOS = task.name === '_RTOS_' || task.name.startsWith('RTOS:');
  const isIdle = task.name === 'IDLE';
  const isISR = task.name.startsWith('ISR:');
  const isTaskCreate = task.name.startsWith('RTOS:Create');
  const taskName = isTaskCreate ? task.name.substring(12) : // Remove 'RTOS:Create ' prefix
                   isISR ? task.name.split(':')[1] :
                   task.name;

  const formatTime = (cycles: number) => {
    return (cycles / cpuFrequency * 1000).toFixed(3) + 'ms';
  };

  const formatPercentage = (value: number) => {
    return value.toFixed(2) + '%';
  };

  return (
    <div className="w-80 glass-morphism overflow-y-auto">
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center text-gray-800 dark:text-white">
            {isTaskCreate ? (
              <span className="text-orange-500">Create Task: {taskName}</span>
            ) : isRTOS ? (
              <span className="text-red-500">RTOS Switch</span>
            ) : isIdle ? (
              <span className="text-gray-500">IDLE Task</span>
            ) : isISR ? (
              <span className="text-purple-500">ISR: {taskName}</span>
            ) : (
              taskName
            )}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {isTaskCreate ? 'Task Creation Event' :
             isRTOS ? 'FreeRTOS Task Switch Operation' : 
             isIdle ? 'System Idle Process' : 
             isISR ? 'Interrupt Service Routine' : 'User Task'}
          </p>
        </div>

        <div className="space-y-3">
          {/* Timing Information */}
          <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
            <div className="flex items-center mb-1 text-gray-800 dark:text-white">
              <Clock className="w-5 h-5 mr-2" />
              <span className="font-medium">Timing</span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300">Current Duration</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white">{formatTime(task.endTime - task.startTime)}</p>
              </div>
              {task.stats && !isTaskCreate && !isRTOS && (
                <>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Average Runtime</p>
                    <p className="text-xl font-bold text-gray-800 dark:text-white">{formatTime(task.stats.averageRunTime)}</p>
                  </div>
                  {task.stats.preemptionCount > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">Time in Preemption</p>
                      <p className="text-xl font-bold text-gray-800 dark:text-white">{formatTime(task.stats.totalPreemptionTime)}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* CPU Usage */}
          {task.stats && !isTaskCreate && !isRTOS && (
            <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
              <div className="flex items-center mb-1 text-gray-800 dark:text-white">
                <Cpu className="w-5 h-5 mr-2" />
                <span className="font-medium">CPU Usage</span>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {isIdle ? 'System Idle Time' : 'CPU Load'}
                  </p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">
                    {formatPercentage(task.stats.cpuLoad)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Execution Statistics */}
          {task.stats && !isTaskCreate && !isRTOS && (
            <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
              <div className="flex items-center mb-1 text-gray-800 dark:text-white">
                <BarChart className="w-5 h-5 mr-2" />
                <span className="font-medium">Statistics</span>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Execution Count</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{task.stats.runCount}</p>
                </div>
                {task.stats.preemptionCount > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Preemption Count</p>
                    <p className="text-xl font-bold text-gray-800 dark:text-white">{task.stats.preemptionCount}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raw Timing Data */}
          <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
            <div className="flex items-center mb-1 text-gray-800 dark:text-white">
              <ArrowRight className="w-5 h-5 mr-2" />
              <span className="font-medium">Raw Timing</span>
            </div>
            <div className="space-y-1">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300">Start Time</p>
                <p className="font-mono text-gray-800 dark:text-white">{task.startTime}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300">End Time</p>
                <p className="font-mono text-gray-800 dark:text-white">{task.endTime}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskDetails;