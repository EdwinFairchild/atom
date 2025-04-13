import React, { useState } from 'react';
import { CheckSquare, Square, Activity, Database, BarChart3, Settings } from 'lucide-react';
import { TaskData } from '../types';
import Modal from './Modal';

interface TopBarProps {
  tasks: TaskData[];
  hiddenTasks: Set<string>;
  onToggleTask: (taskName: string) => void;
  darkMode: boolean;
  onOpenSidebar: () => void;
}

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, onClick, className = '' }) => (
  <div
    className={`glass-morphism p-4 rounded-md cursor-pointer hover:brightness-110 transition-all ${className}`}
    onClick={onClick}
  >
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
        <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
      </div>
      <div className="text-gray-600 dark:text-gray-300">
        {icon}
      </div>
    </div>
  </div>
);

const TopBar: React.FC<TopBarProps> = ({ tasks, hiddenTasks, onToggleTask, darkMode, onOpenSidebar }) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [allTasksVisible, setAllTasksVisible] = useState(true);

  const taskNames = Array.from(new Set(tasks.map(t => t.name))).sort();

  const toggleAllTasks = () => {
    const newState = !allTasksVisible;
    setAllTasksVisible(newState);
    
    taskNames.forEach(taskName => {
      if (newState && hiddenTasks.has(taskName)) {
        onToggleTask(taskName);
      } else if (!newState && !hiddenTasks.has(taskName)) {
        onToggleTask(taskName);
      }
    });
  };

  return (
    <>
      <div className="grid grid-cols-5 gap-4 mb-4">
        <StatsCard
          title="Settings"
          value=""
          icon={<Settings className="w-6 h-6" />}
          onClick={onOpenSidebar}
          className="col-span-1"
        />
        <StatsCard
          title="Tasks"
          value={`${taskNames.length - hiddenTasks.size}/${taskNames.length}`}
          icon={hiddenTasks.size === taskNames.length ? <Square className="w-6 h-6" /> : <CheckSquare className="w-6 h-6" />}
          onClick={() => setActiveModal('tasks')}
          className="col-span-1"
        />
        <StatsCard
          title="Semaphores"
          value="3 Active"
          icon={<Activity className="w-6 h-6" />}
          onClick={() => setActiveModal('semaphores')}
          className="col-span-1"
        />
        <StatsCard
          title="Queues"
          value="2 Pending"
          icon={<Database className="w-6 h-6" />}
          onClick={() => setActiveModal('queues')}
          className="col-span-1"
        />
        <StatsCard
          title="Statistics"
          value="View All"
          icon={<BarChart3 className="w-6 h-6" />}
          onClick={() => setActiveModal('statistics')}
          className="col-span-1"
        />
      </div>

      <Modal
        isOpen={activeModal === 'tasks'}
        onClose={() => setActiveModal(null)}
        title="Task Visibility"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-700">
            <span className="text-gray-800 dark:text-white font-medium">Toggle All Tasks</span>
            <button
              onClick={toggleAllTasks}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {allTasksVisible ? 'Hide All' : 'Show All'}
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {taskNames.map(taskName => (
              <label
                key={taskName}
                className="flex items-center px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!hiddenTasks.has(taskName)}
                  onChange={() => onToggleTask(taskName)}
                  className="mr-3 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-gray-800 dark:text-white">{taskName}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal === 'semaphores'}
        onClose={() => setActiveModal(null)}
        title="Semaphores"
      >
        <div className="text-gray-800 dark:text-white">
          <p>Semaphore details will be implemented here</p>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal === 'queues'}
        onClose={() => setActiveModal(null)}
        title="Queues"
      >
        <div className="text-gray-800 dark:text-white">
          <p>Queue details will be implemented here</p>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal === 'statistics'}
        onClose={() => setActiveModal(null)}
        title="Statistics"
      >
        <div className="text-gray-800 dark:text-white">
          <p>Statistics details will be implemented here</p>
        </div>
      </Modal>
    </>
  );
};

export default TopBar;