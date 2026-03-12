const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getProjects: () => ipcRenderer.invoke("get-projects"),
  refreshProjects: () => ipcRenderer.invoke("refresh-projects"),
  openProject: (path) => ipcRenderer.invoke("open-project", path),
  openInExplorer: (path) => ipcRenderer.invoke("open-in-explorer", path),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  onWindowShown: (callback) => ipcRenderer.on("window-shown", callback),
  onWindowHidden: (callback) => ipcRenderer.on("window-hidden", callback),
  onProjectsUpdated: (callback) => ipcRenderer.on("projects-updated", (_, data) => callback(data)),
});
