import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { ProjectManager } from './projectManager'

const isDev = !!process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
const projectManager = new ProjectManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Dan Video Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// --- IPC: projects ------------------------------------------------------

ipcMain.handle('projects:list', () => projectManager.listProjects())
ipcMain.handle('projects:create', (_e, name: string) => projectManager.createProject(name))
ipcMain.handle('projects:get', (_e, id: string) => projectManager.getProject(id))
ipcMain.handle('projects:delete', (_e, id: string) => projectManager.deleteProject(id))
ipcMain.handle('projects:openFolder', (_e, id: string) => projectManager.openProjectFolder(id))

// --- IPC: assets ----------------------------------------------------------

ipcMain.handle('assets:list', (_e, projectId: string) => projectManager.listAssets(projectId))

ipcMain.handle('assets:import', async (_e, projectId: string) => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import assets',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || result.filePaths.length === 0) return projectManager.listAssets(projectId)
  return projectManager.importAssets(projectId, result.filePaths)
})

ipcMain.handle('assets:delete', (_e, projectId: string, assetId: string) =>
  projectManager.deleteAsset(projectId, assetId),
)
