import React, { useState, useEffect } from 'react';
import TaskTimeline from './components/TaskTimeline';
import TaskDetails from './components/TaskDetails';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import EventTable from './components/EventTable';
import { parseLogFile } from './utils/parser';
import { TaskData } from './types';
import { defaultLogData } from './data/default-log';

const { ipcRenderer } = window.require('electron');

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cpuFrequency, setCpuFrequency] = useState(168000000);
  const [windowSize, setWindowSize] = useState(500);
  const [showCrosshair, setShowCrosshair] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set());
  const [windowPosition, setWindowPosition] = useState(0);

  useEffect(() => {
    loadSettings();
    const parsedTasks = parseLogFile(defaultLogData);
    setTasks(parsedTasks);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const loadSettings = async () => {
    const settings = await ipcRenderer.invoke('load-settings');
    if (settings) {
      setCpuFrequency(settings.cpuFrequency || 168000000);
      setDarkMode(settings.darkMode || false);
      setWindowSize(settings.windowSize || 500);
      setShowCrosshair(settings.showCrosshair || false);
    }
  };

  const saveSettings = async () => {
    await ipcRenderer.invoke('save-settings', {
      cpuFrequency,
      darkMode,
      windowSize,
      showCrosshair
    });
  };

  const handleFileOpen = async () => {
    const content = await ipcRenderer.invoke('open-file');
    if (content) {
      const parsedTasks = parseLogFile(content);
      setTasks(parsedTasks);
    }
  };

  const toggleTaskVisibility = (taskName: string) => {
    const newHiddenTasks = new Set(hiddenTasks);
    if (newHiddenTasks.has(taskName)) {
      newHiddenTasks.delete(taskName);
    } else {
      newHiddenTasks.add(taskName);
    }
    setHiddenTasks(newHiddenTasks);
  };

  const handleTaskSelect = (task: TaskData, shouldScroll = false) => {
    setSelectedTask(task);
    if (shouldScroll) {
      // Update window position to show the selected task
      setWindowPosition(Math.max(0, task.startTime - (windowSize / 4)));
    }
  };

  const visibleTasks = tasks.filter(task => !hiddenTasks.has(task.name));

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen">
        <div className="flex h-screen">
          <div className={`transition-all duration-300 ${sidebarOpen ? 'w-80' : 'w-0'}`}>
            <Sidebar
              isOpen={sidebarOpen}
              cpuFrequency={cpuFrequency}
              setCpuFrequency={setCpuFrequency}
              windowSize={windowSize}
              setWindowSize={setWindowSize}
              showCrosshair={showCrosshair}
              setShowCrosshair={setShowCrosshair}
              selectedTask={selectedTask}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onClose={() => setSidebarOpen(false)}
              onFileOpen={handleFileOpen}
              tasks={tasks}
              hiddenTasks={hiddenTasks}
              onToggleTask={toggleTaskVisibility}
            />
          </div>

          <div className="flex-1 flex flex-col gap-4 p-4">
            <TopBar
              tasks={tasks}
              hiddenTasks={hiddenTasks}
              onToggleTask={toggleTaskVisibility}
              darkMode={darkMode}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
            
            <EventTable
              tasks={visibleTasks}
              cpuFrequency={cpuFrequency}
              darkMode={darkMode}
              onEventSelect={handleTaskSelect}
            />

            <div className="flex-1 min-h-0">
              <TaskTimeline 
                tasks={visibleTasks}
                cpuFrequency={cpuFrequency}
                windowSize={windowSize}
                showCrosshair={showCrosshair}
                onTaskSelect={handleTaskSelect}
                darkMode={darkMode}
                selectedTask={selectedTask}
                windowPosition={windowPosition}
                onWindowPositionChange={setWindowPosition}
              />
            </div>
          </div>
          
          <TaskDetails
            task={selectedTask}
            cpuFrequency={cpuFrequency}
            darkMode={darkMode}
          />
        </div>
      </div>
    </div>
  );
}

export default App;