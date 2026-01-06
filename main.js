// electron/main.js
const { app, BrowserWindow, shell } = require('electron'); // <-- AÑADIDO 'shell', quitado 'dialog' si no lo usas en otro lado
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const url = require('url');

let mainWindow;
let splashWindow;
let postgresProcess;
let nestProcess;

// Ya no necesitamos downloadQueue complejo, Electron maneja la cola de descargas nativa mejor si no la pausamos
const isDev = !app.isPackaged;

const resourcesPath = isDev 
  ? path.join(__dirname, 'resources')
  : process.resourcesPath;

const postgresPath = path.join(resourcesPath, 'postgresql', 'bin');
const apiPath = path.join(resourcesPath, 'api');
const dataPath = path.join(app.getPath('userData'), 'database');

console.log(' Rutas configuradas:');
console.log('   - isDev:', isDev);
console.log('   - resourcesPath:', resourcesPath);
console.log('   - PostgreSQL:', postgresPath);
console.log('   - Backend:', apiPath);
console.log('   - Datos:', dataPath);

// ========================================
//  FUNCIÓN: CREAR SPLASH SCREEN
// ========================================
function createSplashScreen() {
  console.log(' Creando pantalla de carga...');
  
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const splashPath = path.join(__dirname, 'splash.html');
  splashWindow.loadFile(splashPath);
  
  console.log(' Splash screen mostrado');
}

// ========================================
// POSTGRESQL (Sin Cambios)
// ========================================
function startPostgreSQL() {
  return new Promise((resolve, reject) => {
    console.log(' [PostgreSQL] Iniciando...');
    
    if (!fs.existsSync(dataPath)) {
      console.log(' [PostgreSQL] Inicializando BD...');
      const initProcess = spawn(
        path.join(postgresPath, 'initdb.exe'),
        ['-D', dataPath, '-U', 'postgres', '-E', 'UTF8', '--auth=trust'],
        { windowsHide: true, stdio: 'pipe' }
      );
      
      initProcess.on('error', reject);
      initProcess.on('close', (code) => {
        if (code === 0) {
          console.log(' [PostgreSQL] BD inicializada');
          launchPostgres(resolve, reject);
        } else {
          reject(new Error(`initdb falló: ${code}`));
        }
      });
    } else {
      launchPostgres(resolve, reject);
    }
  });
}

function launchPostgres(resolve, reject) {
  postgresProcess = spawn(
    path.join(postgresPath, 'pg_ctl.exe'),
    ['start', '-D', dataPath, '-o', '-p 5433', '-l', path.join(dataPath, 'postgres.log')],
    { windowsHide: true, stdio: 'pipe' }
  );

  postgresProcess.on('error', reject);
  setTimeout(() => {
    console.log(' [PostgreSQL] Corriendo en puerto 5433');
    resolve();
  }, 3000);
}

function createDatabase() {
  return new Promise((resolve) => {
    console.log(' [PostgreSQL] Creando BD "reportes"...');
    
    const createDbProcess = spawn(
      path.join(postgresPath, 'createdb.exe'),
      ['-p', '5433', '-U', 'postgres', 'reportes'],
      { windowsHide: true, stdio: 'pipe' }
    );

    createDbProcess.on('close', (code) => {
      if (code === 0) {
        console.log(' [PostgreSQL] BD "reportes" creada');
      } else {
        console.log('ℹ [PostgreSQL] BD "reportes" ya existe');
      }
      resolve();
    });

    setTimeout(() => resolve(), 3000);
  });
}

function stopPostgreSQL() {
  return new Promise((resolve) => {
    if (postgresProcess) {
      console.log(' [PostgreSQL] Deteniendo...');
      spawn(
        path.join(postgresPath, 'pg_ctl.exe'),
        ['stop', '-D', dataPath, '-m', 'fast'],
        { windowsHide: true }
      ).on('close', () => {
        console.log(' [PostgreSQL] Detenido');
        resolve();
      });
      setTimeout(() => resolve(), 5000);
    } else {
      resolve();
    }
  });
}

// ========================================
// NESTJS (Sin Cambios)
// ========================================
function startNestJS() {
  return new Promise((resolve) => {
    console.log(' [Backend] Iniciando...');
    
    const backendExe = path.join(resourcesPath, 'backend-win.exe');
    
    if (!fs.existsSync(backendExe)) {
      console.error(' [Backend] No encontrado');
      resolve();
      return;
    }

    const env = {
      ...process.env,
      PORT: '3000',
      DATABASE_URL: 'postgresql://postgres@localhost:5433/reportes',
      NODE_ENV: 'production'
    };

    nestProcess = spawn(backendExe, [], { 
      env,
      windowsHide: true,
      stdio: 'pipe'
    });

    nestProcess.stdout.on('data', (data) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });

    nestProcess.stderr.on('data', (data) => {
      console.error(`[Backend Error] ${data.toString().trim()}`);
    });

    setTimeout(() => {
      console.log(' [Backend] Iniciado');
      resolve();
    }, 8000);
  });
}

function stopNestJS() {
  return new Promise((resolve) => {
    if (nestProcess) {
      console.log(' [Backend] Deteniendo...');
      nestProcess.kill();
      nestProcess = null;
    }
    resolve();
  });
}

// ========================================
// VENTANA PRINCIPAL (MODIFICADA)
// ========================================
function createWindow() {
  console.log(' Creando ventana principal...');
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
    icon: path.join(__dirname, 'build/icon.ico'),
    show: false,
    backgroundColor: '#ffffff'
  });

  // ▼▼▼ LÓGICA DE DESCARGA AUTOMÁTICA ▼▼▼
  // Esto elimina el problema de la ventana duplicada al no abrir ninguna ventana
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    
    const fileName = item.getFilename();
    const downloadFolder = app.getPath('downloads'); // Carpeta Descargas por defecto del SO
    const filePath = path.join(downloadFolder, fileName);

    console.log(` Iniciando descarga automática: ${fileName}`);

    // Forzamos la ruta de guardado para evitar el diálogo
    item.setSavePath(filePath);

    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log(' Descarga completada exitosamente.');
        
        // Opcional: Abrir la carpeta donde se guardó o notificar
        // shell.showItemInFolder(filePath); 
        
        // Opcional: Hacer parpadear la ventana para avisar al usuario
        if (!mainWindow.isFocused()) mainWindow.flashFrame(true);

      } else {
        console.log(` Descarga fallida: ${state}`);
      }
    });
  });
  // ▲▲▲ FIN LÓGICA DE DESCARGA ▲▲▲

  let startUrl;
  
  if (isDev) {
    startUrl = 'http://localhost:4200';
    console.log(' DEV:', startUrl);
  } else {
    const possiblePaths = [
      path.join(__dirname, '../dist/frontend/browser/index.html'),
      path.join(__dirname, '../../app.asar.unpacked/dist/frontend/browser/index.html'),
      path.join(process.resourcesPath, 'app.asar.unpacked/dist/frontend/browser/index.html')
    ];
    
    let indexPath = null;
    
    for (const testPath of possiblePaths) {
      console.log(' Probando:', testPath);
      if (fs.existsSync(testPath)) {
        indexPath = testPath;
        console.log(' Encontrado');
        break;
      }
    }
    
    if (indexPath) {
      startUrl = url.format({
        pathname: indexPath,
        protocol: 'file:',
        slashes: true,
        hash: '/'
      });
      console.log(' Cargando:', startUrl);
    } else {
      console.error('index.html NO encontrado');
    }
  }

  if (startUrl) {
    mainWindow.loadURL(startUrl);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
      console.log(' Splash cerrado');
    }
    
    // if (isDev) mainWindow.webContents.openDevTools(); // Puedes descomentar esto si quieres consola en prod
    console.log(' Ventana principal lista');
  });

  mainWindow.on('closed', () => mainWindow = null);
}

// ========================================
// CICLO DE VIDA (Sin Cambios)
// ========================================
app.on('ready', async () => {
  console.log('\n========================================');
  console.log(' SISTEMA DE REPORTES UNT');
  console.log('========================================\n');
  
  try {
    if (!isDev) {
      createSplashScreen();
    }
    
    if (!isDev) {
      console.log(' Modo: PRODUCCIÓN\n');
      await startPostgreSQL();
      await createDatabase();
      await startNestJS();
    } else {
      console.log('🔧 Modo: DESARROLLO\n');
    }
    
    createWindow();
    
    console.log('\n========================================');
    console.log(' SISTEMA LISTO');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n ERROR:', error);
    
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await stopNestJS();
  await stopPostgreSQL();
  app.quit();
});

app.on('before-quit', async (event) => {
  if (nestProcess || postgresProcess) {
    event.preventDefault();
    await stopNestJS();
    await stopPostgreSQL();
    app.exit(0);
  }
});

process.on('uncaughtException', (error) => {
  console.error(' Error:', error);
});