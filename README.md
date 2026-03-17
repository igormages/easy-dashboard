# Easy Dashboard for VS Code

Adds the ability to create and organize projects into a dashboard for quick
launching. Supports both local directories and Remote Development connections
and does not need to be installed on remote hosts to function.

![Alt text](/local/gfx/ex-dashboard.png "Easy Dashboard")

# Auto-Theming

Through the power of the 460 some CSS variables Microsoft has set, Easy Dashboard
tries its best to look good regardless of the theme.

![Alt text](/local/gfx/ex-autotheme.png "Dark and Light")

# Responsive Sizing

With VS Code being Electron this uses standard web tech to be responsive. The
column breaking can be customized in the settings.

![Alt text](/local/gfx/ex-responsive.png "Responsive AF")

# Usage

After installing you should get an icon in the top left which upon clicking
will open the project dashboard. If the window opens without a workspace, it
should open the dashboard automatically.

![Alt text](/local/gfx/ex-first-open.png "First Open")

You can add new projects directly to the dashboard, or you can create new
folders to group the projects. Projects can be dragged and dropped between
different folders and reordered.

The colours and icons of the projects can be changed in their individual
settings. Folders can also manage the colours of projects within to make them
all match or look pretty.

> Note: for the magic pretty to work your folder colour
> must be defined as a const value. So something normal like `#dc143c`. It will
> not work on things like `var()` or `calc()`.

# Easy Dashboard Settings

![Alt text](/local/gfx/ex-dashboard-settings.png "Easy Dashboard Settings")

![Alt text](/local/gfx/ex-project-settings.png "Project Settings")

![Alt text](/local/gfx/ex-folder-menu.png "Folder Menu")

# Syncing (or not if you prefer)

All project settings are stored in your user config file. If you have enabled
settings sync then your dashboard will automatically sync across all your
installations logged in with the same account.

If you do not want them to sync, open the VS Code settings, click the
little gear next to the setting, and uncheck "Sync This Setting".

![Alt text](/local/gfx/ex-setting-sync.png "Don't sync that setting.")

# Publishing (Cursor et Open VSX)

Pour que l’extension soit **installable publiquement dans Cursor** (et autres éditeurs basés sur VS Code), publiez-la sur **Open VSX** (Cursor utilise ce registre, pas le Microsoft Marketplace).

1. **Compte**
   - Créez un compte sur [eclipse.org](https://accounts.eclipse.org).
   - Connectez-vous sur [open-vsx.org](https://open-vsx.org) avec GitHub et liez votre compte Eclipse. Acceptez le Publisher Agreement dans votre profil.

2. **Token**
   - Sur [open-vsx.org/user-settings/tokens](https://open-vsx.org/user-settings/tokens), créez un **Personal Access Token**. Conservez-le en lieu sûr.

3. **CLI `ovsx`**
   ```bash
   npm install -g ovsx
   ```

4. **Namespace (une fois)**
   Le `publisher` dans `package.json` doit exister comme namespace sur Open VSX. Si besoin, créez-le :
   ```bash
   ovsx create-namespace igormages
   ```
   (Utilise le token quand il est demandé.)

5. **Package et publication**
   ```bash
   npm run compile
   npx ovsx publish --pat <VOTRE_TOKEN>
   ```
   Ou avec un .vsix déjà généré :
   ```bash
   npx vsce package
   npx ovsx publish --pat <VOTRE_TOKEN> easy-dashboard-1.1.11.vsix
   ```

Après publication, l’extension apparaît sur [open-vsx.org](https://open-vsx.org) et est **installable depuis Cursor** (Extensions → rechercher « Easy Dashboard » si Cursor est configuré pour utiliser Open VSX).

# Dev Notes

* Make a .vsix installer:
  `vsce package <version>`

* Publish to Open VSX (for Cursor):
  `npx ovsx publish --pat <TOKEN>`

* Publish to Microsoft Marketplace (optional):
  `vsce publish <version>`
