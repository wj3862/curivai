[Setup]
AppName=CurivAI
AppVersion={#GetEnv('APP_VERSION')}
AppPublisher=CurivAI
AppPublisherURL=https://github.com/wj3862/curivai
AppSupportURL=https://github.com/wj3862/curivai/issues
DefaultDirName={autopf}\CurivAI
DefaultGroupName=CurivAI
OutputDir=release
OutputBaseFilename=CurivAI-Setup
SetupIconFile=installer\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\CurivAI.exe
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标"; Flags: unchecked

[Files]
Source: "release\CurivAI.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "release\better_sqlite3.node"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\CurivAI AI信息管家"; Filename: "{app}\CurivAI.exe"
Name: "{group}\卸载 CurivAI"; Filename: "{uninstallexe}"
Name: "{commondesktop}\CurivAI"; Filename: "{app}\CurivAI.exe"; Tasks: desktopicon
Name: "{userdesktop}\CurivAI"; Filename: "{app}\CurivAI.exe"

[Run]
Filename: "{app}\CurivAI.exe"; Description: "立即启动 CurivAI"; Flags: nowait postinstall skipifsilent
