import React from 'react';
import { X, FileUp, Moon, Sun } from 'lucide-react';
import { TaskData } from '../types';

interface SidebarProps {
  isOpen: boolean;
  cpuFrequency: number;
  setCpuFrequency: (freq: number) => void;
  windowSize: number;
  setWindowSize: (size: number) => void;
  showCrosshair: boolean;
  setShowCrosshair: (show: boolean) => void;
  selectedTask: TaskData | null;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  onClose: () => void;
  onFileOpen: () => void;
  tasks: TaskData[];
  hiddenTasks: Set<string>;
  onToggleTask: (taskName: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  cpuFrequency,
  setCpuFrequency,
  windowSize,
  setWindowSize,
  showCrosshair,
  setShowCrosshair,
  darkMode,
  setDarkMode,
  onClose,
  onFileOpen,
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-80 h-full glass-morphism overflow-y-auto">
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Settings</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-gray-900 dark:text-white"
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-gray-900 dark:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={onFileOpen}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600/90 hover:bg-blue-600 text-white rounded-md backdrop-blur-sm transition-colors"
          >
            <FileUp className="w-4 h-4" />
            <span>Open Log File</span>
          </button>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">CPU Frequency (Hz)</label>
            <input
              type="number"
              value={cpuFrequency}
              onChange={(e) => setCpuFrequency(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-gray-200 dark:border-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-white"
            />
          </div>

          {/* <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">Window Size (tasks)</label>
            <input
              type="number"
              min="100"
              max="2000"
              step="100"
              value={windowSize}
              onChange={(e) => setWindowSize(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-gray-200 dark:border-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-white"
            />
          </div> */}

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-900 dark:text-white">Show Crosshair</label>
            <button
              onClick={() => setShowCrosshair(!showCrosshair)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                showCrosshair ? 'bg-blue-600' : 'bg-gray-200 dark:bg-white/20'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  showCrosshair ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;