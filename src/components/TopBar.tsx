import React, { useState, useMemo } from 'react';
import { CheckSquare, Square, Activity, Database, BarChart3, Settings, X } from 'lucide-react';
import { TaskData } from '../types'; // Ensure types.ts uses bigint
import Modal from './Modal'; // Assuming Modal component exists and works

interface TopBarProps {
  tasks: TaskData[]; // Receive all tasks
  hiddenTasks: Set<string>;
  onToggleTask: (taskName: string) => void;
  darkMode: boolean;
  onOpenSidebar: () => void;
}

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  onClick?: () => void; // Make onClick optional
  className?: string;
  disabled?: boolean;
}

// Stats Card Component (no changes needed for bigint)
const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, onClick, className = '', disabled = false }) => (
  <div
    className={`glass-morphism p-3 rounded-lg transition-all ${className} ${
      disabled
        ? 'opacity-50 cursor-not-allowed'
        : onClick
        ? 'cursor-pointer hover:brightness-110'
        : ''
    }`}
    onClick={!disabled && onClick ? onClick : undefined}
  >
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">{title}</p>
        <p className={`text-xl font-bold ${value ? 'text-gray-800 dark:text-white' : 'text-transparent'}`}>{value || '-'}</p> {/* Show dash if no value */}
      </div>
      <div className="text-gray-500 dark:text-gray-400">
        {icon}
      </div>
    </div>
  </div>
);

const TopBar: React.FC<TopBarProps> = ({ tasks, hiddenTasks, onToggleTask, darkMode, onOpenSidebar }) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Get unique task names (no bigint involved)
  const taskNames = useMemo(() => {
      return Array.from(new Set(tasks.map(t => t.name))).sort();
  }, [tasks]);

  // Determine if all tasks are currently visible
  const allTasksVisible = useMemo(() => {
      if (taskNames.length === 0) return true; // No tasks means all (zero) are visible
      return taskNames.every(name => !hiddenTasks.has(name));
  }, [taskNames, hiddenTasks]);

  // Toggle all tasks visibility
  const toggleAllTasks = () => {
    const targetVisibility = !allTasksVisible; // If currently all visible, hide all; otherwise show all.
    taskNames.forEach(taskName => {
      const isHidden = hiddenTasks.has(taskName);
      // If we want to show all, and task is hidden -> toggle it (show)
      // If we want to hide all, and task is visible -> toggle it (hide)
      if ((targetVisibility && isHidden) || (!targetVisibility && !isHidden)) {
        onToggleTask(taskName);
      }
    });
  };

  return (
    <>
      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4 flex-shrink-0">
        <StatsCard
          title="Settings"
          value="" // No value needed, it's a button
          icon={<Settings className="w-5 h-5" />}
          onClick={onOpenSidebar}
          className="col-span-1"
        />
        <StatsCard
          title="Tasks"
          value={taskNames.length > 0 ? `${taskNames.length - hiddenTasks.size}/${taskNames.length}` : '0/0'}
          icon={allTasksVisible ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
          onClick={() => taskNames.length > 0 && setActiveModal('tasks')} // Only open modal if tasks exist
          className="col-span-1"
          disabled={taskNames.length === 0}
        />
        {/* Placeholder Cards - Disabled */}
        <StatsCard
          title="Semaphores"
          value="N/A"
          icon={<Activity className="w-5 h-5" />}
          // onClick={() => setActiveModal('semaphores')} // Disabled for now
          className="col-span-1"
          disabled={true}
        />
        <StatsCard
          title="Queues"
          value="N/A"
          icon={<Database className="w-5 h-5" />}
          // onClick={() => setActiveModal('queues')} // Disabled for now
          className="col-span-1"
          disabled={true}
        />
        <StatsCard
          title="Statistics"
          value="N/A"
          icon={<BarChart3 className="w-5 h-5" />}
          // onClick={() => setActiveModal('statistics')} // Disabled for now
          className="col-span-1"
          disabled={true}
        />
      </div>

      {/* Task Visibility Modal */}
      <Modal
        isOpen={activeModal === 'tasks'}
        onClose={() => setActiveModal(null)}
        title="Task Visibility"
      >
        <div className="space-y-4">
          {/* Toggle All Button */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
            <span className="text-gray-800 dark:text-white font-medium text-sm">
              {allTasksVisible ? 'All tasks shown' : `${hiddenTasks.size} tasks hidden`}
            </span>
            <button
              onClick={toggleAllTasks}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-3 py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            >
              {allTasksVisible ? 'Hide All' : 'Show All'}
            </button>
          </div>
          {/* Task List */}
          <div className="space-y-1 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent pr-2">
            {taskNames.map(taskName => (
              <label
                key={taskName}
                className="flex items-center px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={!hiddenTasks.has(taskName)}
                  onChange={() => onToggleTask(taskName)}
                  className="mr-3 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-700 dark:checked:bg-blue-500"
                />
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{taskName}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Placeholder Modals (Content can be added later) */}
      <Modal
        isOpen={activeModal === 'semaphores'}
        onClose={() => setActiveModal(null)}
        title="Semaphores (Not Implemented)"
      >
        <div className="text-gray-800 dark:text-white text-sm">
          <p>Details about semaphore usage will be displayed here once implemented in the parser and UI.</p>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal === 'queues'}
        onClose={() => setActiveModal(null)}
        title="Queues (Not Implemented)"
      >
        <div className="text-gray-800 dark:text-white text-sm">
          <p>Details about message queue usage will be displayed here once implemented.</p>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal === 'statistics'}
        onClose={() => setActiveModal(null)}
        title="Statistics (Not Implemented)"
      >
        <div className="text-gray-800 dark:text-white text-sm">
          <p>Overall system statistics (CPU load, context switches, etc.) will be displayed here once implemented.</p>
        </div>
      </Modal>
    </>
  );
};

export default TopBar;