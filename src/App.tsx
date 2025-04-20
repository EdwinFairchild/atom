import React, { useState, useEffect, useCallback , useMemo} from 'react';
import TaskTimeline from './components/TaskTimeline';
import TaskDetails from './components/TaskDetails';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import EventTable from './components/EventTable';
// Remove parseLogFile import if only using binary
// import { parseLogFile } from './utils/parser';
import { parseBinaryLogFile } from './utils/binaryParser';
import { TaskData } from './types'; // Ensure types.ts uses bigint
// Remove defaultLogData if not needed as fallback
// import { defaultLogData } from './data/default-log';

// Check if running in Electron environment
const isElectron = !!window.require;
const ipcRenderer = isElectron ? window.require('electron').ipcRenderer : null;

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cpuFrequency, setCpuFrequency] = useState(168000000); // Default
  const [windowSize, setWindowSize] = useState(500); // Consider renaming if it's task count
  const [showCrosshair, setShowCrosshair] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set());
  // windowPosition represents the start time (numeric) of the visible window in the main timeline
  const [windowPosition, setWindowPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);


  // Load initial settings and potentially default data
  useEffect(() => {
    if (isElectron) {
        loadSettings();
    }
    // Load default data only if no file is loaded initially?
    // const parsedTasks = parseLogFile(defaultLogData); // Or use a default binary if available
    // setTasks(parsedTasks);
    // setWindowPosition(0); // Reset position for default data
  }, []);

  // Apply dark mode class
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // --- Settings Management ---
  const loadSettings = useCallback(async () => {
    if (!ipcRenderer) return;
    try {
      const settings = await ipcRenderer.invoke('load-settings');
      if (settings) {
        setCpuFrequency(settings.cpuFrequency || 168000000);
        setDarkMode(settings.darkMode || false);
        setWindowSize(settings.windowSize || 500); // Task count?
        setShowCrosshair(settings.showCrosshair || false);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
      setError("Could not load settings.");
    }
  }, []);

  // Debounced save settings
  useEffect(() => {
      if (!isElectron) return;
      const handler = setTimeout(() => {
          ipcRenderer.invoke('save-settings', {
              cpuFrequency,
              darkMode,
              windowSize,
              showCrosshair
          }).catch(err => console.error("Failed to save settings:", err));
      }, 1000); // Save 1 second after last change

      return () => clearTimeout(handler);
  }, [cpuFrequency, darkMode, windowSize, showCrosshair]);


  // --- File Handling ---
  const handleFileOpen = useCallback(async () => {
    if (!ipcRenderer) {
        setError("File operations only available in Electron app.");
        return;
    }
    setError(null);
    setIsLoading(true);
    setSelectedTask(null); // Deselect task when opening new file

    try {
      // Use the specific binary file handler
      const result = await ipcRenderer.invoke('open-file-binary');

      // Handle cancellation or no selection
      if (result === null) {
        console.log("File open cancelled or no file selected.");
        setIsLoading(false);
        return;
      }

      // --- MODIFIED VALIDATION ---
      // Check if data is Uint8Array (common result after IPC serialization)
      // or Buffer (less common now but possible in some configs)
      const isBufferLike = result && result.data && (result.data instanceof Uint8Array || result.data instanceof Buffer);

      if (result && result.type === 'binary' && isBufferLike && result.filePath) {
        // Determine the received type for logging
        const receivedType = result.data instanceof Buffer ? 'Buffer' : 'Uint8Array';
        console.log(`Received binary data (${receivedType}) for: ${result.filePath}, size: ${result.data.length}`);

        // --- CONVERT TO BUFFER ---
        // Ensure we have a Buffer object for the parser, converting if necessary
        const fileBuffer = result.data instanceof Buffer ? result.data : Buffer.from(result.data);

        const parsedTasks = parseBinaryLogFile(fileBuffer); // Pass the Buffer
        console.log(`Parsed ${parsedTasks.length} tasks/events.`);

        setTasks(parsedTasks);
        setFilePath(result.filePath); // Store file path

        // Reset view state for new file
        setWindowPosition(0); // Reset scroll position to the beginning
        setHiddenTasks(new Set()); // Show all tasks initially
        setSelectedTask(null);

      } else {
         // Log the actual structure/type received if validation failed
         const receivedDataType = result && result.data ? result.data.constructor.name : 'undefined';
         console.error(`Received unexpected data structure or type from main process. Expected Uint8Array or Buffer, got: ${receivedDataType}`, result);
         setError("Failed to receive valid binary file data.");
         setTasks([]); // Clear tasks on error
         setFilePath(null);
      }
      // --- END OF MODIFIED BLOCK ---

    } catch (err: any) {
      console.error("Error opening or parsing file:", err);
      setError(`Error: ${err.message || 'Failed to open or parse file.'}`);
      setTasks([]); // Clear tasks on error
      setFilePath(null);
    } finally {
      setIsLoading(false);
    }
  }, []); // Dependencies remain empty as it uses setters and ipcRenderer

  // --- Task Visibility ---
  const toggleTaskVisibility = useCallback((taskName: string) => {
    setHiddenTasks(prevHiddenTasks => {
      const newHiddenTasks = new Set(prevHiddenTasks);
      if (newHiddenTasks.has(taskName)) {
        newHiddenTasks.delete(taskName);
      } else {
        newHiddenTasks.add(taskName);
      }
      return newHiddenTasks;
    });
  }, []);

  // --- Task Selection ---
  const handleTaskSelect = useCallback((task: TaskData | null, shouldScroll = false) => {
    setSelectedTask(task);
    if (task && shouldScroll) {
      // Calculate a suitable window start position (numeric) to show the task
      // Center the task roughly in the window if possible
      // Need windowTimeWidth from TaskTimeline, or estimate it here
      // For simplicity, just move window start slightly before task start
      const taskStartTimeNum = Number(task.startTime);
      // Estimate window width in time (needs improvement for accuracy)
      const estimatedWindowTimeNum = tasks.length > 0 ? (Number(tasks[tasks.length-1].endTime - tasks[0].startTime) / 10) : 1000000;
      const targetPosition = Math.max(0, taskStartTimeNum - estimatedWindowTimeNum / 4);
      setWindowPosition(targetPosition);
    }
  }, [tasks]); // Dependency on tasks for estimation

  // Filter tasks based on visibility
  const visibleTasks = useMemo(() => {
      return tasks.filter(task => !hiddenTasks.has(task.name));
  }, [tasks, hiddenTasks]);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="flex h-screen">
          {/* Sidebar */}
          <div className={`transition-all duration-300 ${sidebarOpen ? 'w-80' : 'w-0'} overflow-hidden flex-shrink-0`}>
            <Sidebar
              isOpen={sidebarOpen}
              cpuFrequency={cpuFrequency}
              setCpuFrequency={setCpuFrequency}
              windowSize={windowSize} // Pass windowSize (task count?)
              setWindowSize={setWindowSize}
              showCrosshair={showCrosshair}
              setShowCrosshair={setShowCrosshair}
              selectedTask={selectedTask}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onClose={() => setSidebarOpen(false)}
              onFileOpen={handleFileOpen}
              tasks={tasks} // Pass all tasks for list
              hiddenTasks={hiddenTasks}
              onToggleTask={toggleTaskVisibility}
              isLoading={isLoading}
              error={error}
              filePath={filePath}
            />
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col gap-4 p-4 overflow-hidden"> {/* Added overflow-hidden */}
            <TopBar
              tasks={tasks} // Pass all tasks for stats/modal
              hiddenTasks={hiddenTasks}
              onToggleTask={toggleTaskVisibility}
              darkMode={darkMode}
              onOpenSidebar={() => setSidebarOpen(true)}
            />

            {/* Event Table */}
            <div className="h-[30vh] flex-shrink-0"> {/* Fixed height for table */}
                <EventTable
                  tasks={visibleTasks} // Pass only visible tasks? Or all? Pass all for now.
                  cpuFrequency={cpuFrequency}
                  darkMode={darkMode}
                  onEventSelect={handleTaskSelect} // Use the selection handler
                />
            </div>

            {/* Task Timeline */}
            <div className="flex-1 min-h-0"> {/* Allow timeline to take remaining space */}
              {tasks.length > 0 ? (
                  <TaskTimeline
                    tasks={visibleTasks} // Pass filtered tasks
                    cpuFrequency={cpuFrequency}
                    windowSize={windowSize} // Pass windowSize (task count?)
                    showCrosshair={showCrosshair}
                    onTaskSelect={handleTaskSelect} // Use the selection handler
                    darkMode={darkMode}
                    selectedTask={selectedTask}
                    windowPosition={windowPosition} // Pass numeric window start time
                    onWindowPositionChange={setWindowPosition} // Allow timeline to update position
                  />
              ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                      {isLoading ? "Loading..." : (error ? `Error: ${error}` : "Open a binary log file (.bin, .log) using the sidebar.")}
                  </div>
              )}
            </div>
          </div>

          {/* Task Details Panel */}
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