import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, DeskApi, Task } from '../shared/types';

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

const api: DeskApi = {
  listTasks: call('listTasks') as DeskApi['listTasks'],
  getEvents: call('getEvents') as DeskApi['getEvents'],
  createTask: call('createTask') as DeskApi['createTask'],
  confirmTask: call('confirmTask') as DeskApi['confirmTask'],
  cancelTask: call('cancelTask') as DeskApi['cancelTask'],
  resumeTask: call('resumeTask') as DeskApi['resumeTask'],
  cleanupTask: call('cleanupTask') as DeskApi['cleanupTask'],
  openFolder: call('openFolder') as DeskApi['openFolder'],
  pickRepo: call('pickRepo') as DeskApi['pickRepo'],
  checkRepo: call('checkRepo') as DeskApi['checkRepo'],
  paidKeys: call('paidKeys') as DeskApi['paidKeys'],
  overview: call('overview') as DeskApi['overview'],
  openSession: call('openSession') as DeskApi['openSession'],
  onTaskUpdate: (cb) => {
    const h = (_e: unknown, t: Task) => cb(t);
    ipcRenderer.on('task:update', h);
    return () => ipcRenderer.removeListener('task:update', h);
  },
  onTaskEvent: (cb) => {
    const h = (_e: unknown, id: string, ev: AgentEvent) => cb(id, ev);
    ipcRenderer.on('task:event', h);
    return () => ipcRenderer.removeListener('task:event', h);
  },
};

contextBridge.exposeInMainWorld('desk', api);
