import { TaskData, TaskStats, Preemption } from '../types';

// --- Constants based on profiler.h ---
const PROF_EVENT_TYPE_MASK = 0x7F;
const PROF_EVENT_FLAG_START_END = 0x80; // MSB flag: 1=START/ENTER, 0=END/EXIT

const PROF_EVENT_TASK_SWITCH = 0x01;
const PROF_EVENT_ISR = 0x02;
const PROF_EVENT_TASK_CREATE = 0x03; // Assumed for task creation events

const PROF_SETUP_TASK_MAP = 0x70;
const PROF_SETUP_ISR_MAP = 0x71;
const PROF_SETUP_INFO = 0x7F;

// --- Helper: Parses the binary buffer ---
export function parseBinaryLogFile(content: Buffer): TaskData[] {
    const tasks: TaskData[] = [];
    const taskNameMap = new Map<number, string>();
    const isrNameMap = new Map<number, string>();
    let cpuFrequency: number | null = null;

    // --- State for parsing runtime events ---
    let offset = 0;
    let lastEndTime: bigint | null = null;
    const taskStartMap = new Map<number, { startTime: bigint; preemptions: Preemption[] }>();
    const isrStartMap = new Map<number, bigint>();
    let activeTaskId: number | null = null;

    //console.log(`Parsing binary log buffer of size: ${content.length} bytes`);

    try {
        while (offset < content.length) {
            const packetType = content.readUInt8(offset);

            // --- Handle Setup Packets ---
            if (packetType >= 0x70 && packetType <= 0x7F) {
                if (offset + 3 > content.length) {
                    //console.warn(`Incomplete setup packet header at offset ${offset}`);
                    break;
                }
                const setupCode = packetType;
                const id = content.readUInt8(offset + 1);
                const nameLen = content.readUInt8(offset + 2);

                if (offset + 3 + nameLen > content.length) {
                    //console.warn(`Incomplete setup packet data at offset ${offset}`);
                    break;
                }

                const name = content.subarray(offset + 3, offset + 3 + nameLen).toString('utf-8');

                if (setupCode === PROF_SETUP_TASK_MAP) {
                    taskNameMap.set(id, name);
                    //console.log(`MAP Task ID ${id} -> "${name}"`);
                } else if (setupCode === PROF_SETUP_ISR_MAP) {
                    isrNameMap.set(id, name);
                    //console.log(`MAP ISR ID ${id} -> "${name}"`);
                } else if (setupCode === PROF_SETUP_INFO) {
                    //console.log(`INFO: "${name}"`);
                    if (name.startsWith("CLK:")) {
                        try {
                            cpuFrequency = parseInt(name.substring(4), 10);
                            //console.log(`Parsed CPU Frequency: ${cpuFrequency} Hz`);
                        } catch (e) {
                            //console.warn("Could not parse CPU frequency");
                        }
                    }
                } else {
                    //console.warn(`Unknown setup code ${setupCode.toString(16)} at offset ${offset}`);
                }

                offset += 3 + nameLen;
                continue;
            }

            // --- Handle Event Packets (10 bytes) ---
            const packetSize = 10;
            if (offset + packetSize > content.length) {
                //console.warn(`Incomplete event packet at offset ${offset}`);
                break;
            }

            const typeByte = packetType;
            const eventType = typeByte & PROF_EVENT_TYPE_MASK;
            const isStartEvent = (typeByte & PROF_EVENT_FLAG_START_END) !== 0;
            const id = content.readUInt8(offset + 1);
            const timestamp = content.readBigUInt64LE(offset + 2);

            // Insert RTOS gap if needed BEFORE processing start or create events
            if ((isStartEvent || eventType === PROF_EVENT_TASK_CREATE) && lastEndTime !== null && timestamp > lastEndTime) {
                const gap = timestamp - lastEndTime;
                if (gap > 0n) {
                    tasks.push({
                        name: "_RTOS_",
                        startTime: lastEndTime,
                        endTime: timestamp,
                        preemptions: []
                    });
                }
            }

            // --- Process Specific Event Types ---
            switch (eventType) {
                case PROF_EVENT_TASK_SWITCH: {
                    const taskName = taskNameMap.get(id) || `TaskID_${id}`;
                    if (isStartEvent) {
                        // Task START
                        taskStartMap.set(id, { startTime: timestamp, preemptions: [] });
                        activeTaskId = id;
                        lastEndTime = null;
                        //console.log(`[${timestamp}] Task START: ${taskName} (${id})`);
                    } else {
                        // Task END
                        const startInfo = taskStartMap.get(id);
                        if (startInfo) {
                            tasks.push({
                                name: taskName,
                                startTime: startInfo.startTime,
                                endTime: timestamp,
                                preemptions: startInfo.preemptions
                            });
                            taskStartMap.delete(id);
                            lastEndTime = timestamp;
                        } else {
                            //console.warn(`Task END event for ID ${id} (${taskName}) without START at ${timestamp}`);
                        }
                        if (activeTaskId === id) {
                            activeTaskId = null;
                        }
                    }
                    break;
                }

                case PROF_EVENT_TASK_CREATE: {
                    const taskName = taskNameMap.get(id) || `TaskID_${id}`;
                    // Create a synthetic task for task creation, matching old parser
                    tasks.push({
                        name: `RTOS:Create`,
                        startTime: timestamp,
                        endTime: timestamp,
                        preemptions: []
                    });
                    lastEndTime = timestamp;
                    //console.log(`[${timestamp}] Task CREATE: ${taskName} (${id})`);
                    break;
                }

                case PROF_EVENT_ISR: {
                    const isrName = isrNameMap.get(id) || `ISRID_${id}`;
                    if (isStartEvent) {
                        // ISR ENTER
                        isrStartMap.set(id, timestamp);
                        if (activeTaskId !== null) {
                            const activeTaskInfo = taskStartMap.get(activeTaskId);
                            if (activeTaskInfo) {
                                activeTaskInfo.preemptions.push({
                                    startTime: timestamp,
                                    endTime: 0n,
                                    isrName
                                });
                            } else {
                                //console.warn(`ISR ENTER ${isrName} for activeTaskId=${activeTaskId}, but no start info`);
                            }
                        }
                        //console.log(`[${timestamp}] ISR ENTER: ${isrName} (${id})`);
                    } else {
                        // ISR EXIT
                        const startTime = isrStartMap.get(id);
                        if (startTime) {
                            tasks.push({
                                name: `ISR:${isrName}`,
                                startTime: startTime,
                                endTime: timestamp,
                                preemptions: []
                            });
                            isrStartMap.delete(id);

                            if (activeTaskId !== null) {
                                const activeTaskInfo = taskStartMap.get(activeTaskId);
                                if (activeTaskInfo) {
                                    const openPreemption = activeTaskInfo.preemptions.findLast(
                                        p => p.isrName === isrName && p.endTime === 0n
                                    );
                                    if (openPreemption) {
                                        openPreemption.endTime = timestamp;
                                    } else {
                                        //console.warn(`ISR EXIT ${isrName} for task ${activeTaskId}, no matching preemption`);
                                    }
                                }
                            }
                        } else {
                            //console.warn(`ISR EXIT for ID ${id} (${isrName}) without ENTER at ${timestamp}`);
                        }
                        //console.log(`[${timestamp}] ISR EXIT: ${isrName} (${id})`);
                    }
                    break;
                }

                default:
                    //console.warn(`Unknown event type ${eventType.toString(16)} at offset ${offset}`);
                    break;
            }

            offset += packetSize;
        }

    } catch (e: any) {
        //console.error(`Error parsing binary log at offset ${offset}:`, e);
        // Continue with parsed tasks instead of returning empty array
    }

    //console.log(`Finished parsing. Found ${tasks.length} timeline entries.`);
    //console.log(`Task Name Map:`, taskNameMap);
    //console.log(`ISR Name Map:`, isrNameMap);

    // Handle unclosed tasks
    taskStartMap.forEach((startInfo, id) => {
        const taskName = taskNameMap.get(id) || `TaskID_${id}`;
        //console.warn(`Task "${taskName}" (ID: ${id}) started at ${startInfo.startTime} but never ended`);
    });

    if (tasks.length === 0) {
        //console.warn("No valid task/ISR entries generated");
        return [];
    }

    // Sort tasks by start time
    tasks.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));

    // Calculate statistics
    calculateTaskStats(tasks);

    return tasks;
}

// --- Calculate Task Stats (aligned with old parser) ---
function calculateTaskStats(tasks: TaskData[]): void {
    if (!tasks || tasks.length === 0) {
        //console.warn("calculateTaskStats: No tasks to process");
        return;
    }

    // Get total timeline duration
    const timelineStart = tasks.reduce((min, t) => t.startTime < min ? t.startTime : min, tasks[0].startTime);
    const timelineEnd = tasks.reduce((max, t) => t.endTime > max ? t.endTime : max, tasks[0].endTime);
    const totalTimelineDuration = timelineEnd - timelineStart;

    if (totalTimelineDuration <= 0n) {
        //console.error("Invalid timeline duration:", totalTimelineDuration);
        tasks.forEach(task => {
            task.stats = createDefaultStats();
        });
        return;
    }

    // Group tasks by name
    const taskGroups = new Map<string, TaskData[]>();
    tasks.forEach(task => {
        const existing = taskGroups.get(task.name) || [];
        existing.push(task);
        taskGroups.set(task.name, existing);
    });

    // Calculate stats for each task group
    taskGroups.forEach((taskInstances, taskName) => {
        let totalRunTime = 0n;
        let actualRunTime = 0n;
        let totalPreemptionTime = 0n;
        let preemptionCount = 0;

        taskInstances.forEach(task => {
            const duration = task.endTime >= task.startTime ? task.endTime - task.startTime : 0n;
            totalRunTime += duration;

            let preemptionTimeForThisSlice = 0n;
            if (task.preemptions && task.preemptions.length > 0) {
                preemptionCount += task.preemptions.length;
                preemptionTimeForThisSlice = task.preemptions.reduce((acc, p) => {
                    const pDuration = p.endTime > p.startTime ? p.endTime - p.startTime : 0n;
                    return acc + pDuration;
                }, 0n);

                preemptionTimeForThisSlice = preemptionTimeForThisSlice > duration ? duration : preemptionTimeForThisSlice;
                totalPreemptionTime += preemptionTimeForThisSlice;
            }
            actualRunTime += duration - preemptionTimeForThisSlice;
        });

        // Calculate CPU load (match old parser's precision)
        const cpuLoad = Number((actualRunTime * BigInt(10000) / totalTimelineDuration)) / 100;

        const stats: TaskStats = {
            totalRunTime,
            actualRunTime,
            runCount: taskInstances.length,
            cpuLoad: Math.max(0, Math.min(100, cpuLoad)),
            averageRunTime: taskInstances.length > 0 ? actualRunTime / BigInt(taskInstances.length) : 0n,
            preemptionCount,
            totalPreemptionTime
        };

        taskInstances.forEach(task => {
            task.stats = stats;
        });
    });

    // Log total CPU load
    let totalCalculatedLoad = 0;
    taskGroups.forEach((instances) => {
        if (instances.length > 0 && instances[0].stats) {
            totalCalculatedLoad += instances[0].stats.cpuLoad;
        }
    });
    //console.log("Sum of all calculated CPU loads:", totalCalculatedLoad.toFixed(2), "%");
}

// --- Default Stats ---
function createDefaultStats(): TaskStats {
    return {
        totalRunTime: 0n,
        actualRunTime: 0n,
        runCount: 0,
        cpuLoad: 0,
        averageRunTime: 0n,
        preemptionCount: 0,
        totalPreemptionTime: 0n
    };
}