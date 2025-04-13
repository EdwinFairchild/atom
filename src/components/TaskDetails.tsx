import React from 'react';
import { TaskData } from '../types';
import { Activity, Clock, ArrowRight } from 'lucide-react';

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
  const isRTOS = task.name === '_RTOS_';
  const isIdle = task.name === 'IDLE';

  return (
    <div className="w-80 glass-morphism overflow-y-auto">
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center text-gray-800 dark:text-white">
            {isRTOS ? (
              <span className="text-red-500">RTOS Switch</span>
            ) : isIdle ? (
              <span className="text-gray-500">IDLE Task</span>
            ) : (
              task.name
            )}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {isRTOS ? 'FreeRTOS Task Switch Operation' : isIdle ? 'System Idle Process' : 'User Task'}
          </p>
        </div>

        <div className="space-y-3">
          <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
            <div className="flex items-center mb-1 text-gray-800 dark:text-white">
              <Clock className="w-5 h-5 mr-2" />
              <span className="font-medium">Duration</span>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800 dark:text-white">{duration.toFixed(3)} s</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {task.endTime - task.startTime} cycles
              </p>
            </div>
          </div>

          <div className="p-3 rounded-md bg-gray-50 dark:bg-white/5">
            <div className="flex items-center mb-1 text-gray-800 dark:text-white">
              <ArrowRight className="w-5 h-5 mr-2" />
              <span className="font-medium">Timing</span>
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