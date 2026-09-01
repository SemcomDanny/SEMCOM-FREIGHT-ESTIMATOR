# Running the estimator on your own machine

This is the recommended setup for a small team: the tool runs on one computer
in the office and everyone else reaches it in a browser. Nothing goes to the
cloud, there is no monthly bill, and your rate cards never leave the building.

## What you need

**A computer that stays on.** Any Windows, Mac or Linux machine will do — this
is a small application and an old office PC handles it comfortably. It needs to
be on whenever someone wants to use the tool, so a desktop that lives in the
corner beats someone's laptop.

**Node.js 22 or 24**, from [nodejs.org](https://nodejs.org). Take the version
marked LTS and accept the defaults. Node 20 is too old for the database
library, and versions newer than 24 may not have a pre-compiled build yet — if
one doesn't, the install tries to compile it from source and fails asking for
Visual Studio. The installer checks your version and says so before it gets
that far.

That is the whole list. There is no database to install — the tool keeps
everything in a single file.

## Setting it up

On Windows use **Command Prompt**, not PowerShell — PowerShell blocks npm by
default with a message about "running scripts is disabled on this system".
Press Start, type `cmd`, and open Command Prompt. On a Mac, use Terminal.

Run these one at a time:

```bash
git clone https://github.com/SemcomDanny/SEMCOM-FREIGHT-ESTIMATOR.git
cd SEMCOM-FREIGHT-ESTIMATOR
git checkout claude/freight-estimate-container-tool-ryc7mq
npm install
npm run setup
npm run build
npm start
```

Run them one at a time and wait for each to finish.

The third line is only needed until this work is merged into the `main`
branch. Without it you get an empty folder and `npm install` says it cannot
find `package.json`.

`npm install` takes a few minutes the first time. `npm run setup` prints a
generated admin password — **write it down before you continue**, it is not
shown again.

When it starts you will see something like:

```
Semcom Freight Estimator is running.

  On this computer:   http://localhost:4000
  On the network:     http://192.168.1.42:4000
```

Open the first address on this machine to check it works. Sign in with
`admin@sem.com.au` and the password from the setup step.

**Leave that terminal window open.** Closing it stops the tool for everyone.

## Letting everyone else in

Give the team the **network** address (`http://192.168.1.42:4000` in the example
above — yours will differ). It works in any browser on the office network, on
phones and tablets too.

If other computers cannot reach it, the host machine's firewall is blocking the
port. On Windows, the first time you run it you should get a prompt asking
whether to allow Node.js through the firewall — say yes, and tick "Private
networks". If you dismissed that prompt, run PowerShell **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "Semcom Freight Estimator" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow -Profile Private
```

On a Mac, System Settings → Network → Firewall → Options, and allow incoming
connections for Node.

**The address changes if the machine's IP changes.** Ask whoever runs your
network to give that computer a fixed (static) IP, or a DHCP reservation.
Otherwise the link you sent round will stop working one day for no obvious
reason.

## Adding your team

Sign in as the admin, go to **Admin → Users**, and add each person with the
Estimator role. Only give the Admin role to whoever maintains the rate cards —
estimators can use every rate but not change one.

Change the generated admin password to something you will remember: add a new
admin user for yourself, sign in as them, then deactivate the original
`admin@sem.com.au` account.

## Keeping it running

The tool stops when the terminal closes or the machine reboots. To keep it up
without thinking about it, install a small process manager:

```bash
npm install -g pm2
pm2 start npm --name semcom-freight -- start
pm2 save
pm2 startup        # prints one more command to run — follow it
```

After that it restarts on boot and after crashes. `pm2 logs semcom-freight`
shows what it is doing; `pm2 restart semcom-freight` restarts it.

## Backups

Everything — every rate version, job, estimate and audit record — lives in one
file: `data/semcom.db`. If that file is lost, all of it is lost.

```bash
npm run backup
```

That writes a timestamped, consistent copy into `data/backups/` and keeps the
most recent 30. It is safe to run while the tool is in use.

Run it on a schedule. On Mac or Linux, `crontab -e` and add:

```
0 19 * * 1-5 cd /path/to/SEMCOM-FREIGHT-ESTIMATOR && npm run backup
```

On Windows, use Task Scheduler to run `npm run backup` in the project folder
each evening.

**Copy those backups somewhere else as well** — a network drive, OneDrive, an
external disk. A backup on the same machine does not survive that machine
dying.

To restore: stop the tool, copy the backup over `data/semcom.db`, start it
again.

## Sending rate requests to forwarders

From the Rates tab you can send a forwarder a link that lets them type their
LCL and FCL rates straight in — no account, no rate sheet to retype — and
optionally attach their PDF quote. When it comes back you import it as a rate
version in one click.

This works with no setup: the tool creates the link and you send it from your
own email. To have it emailed automatically, add your mail server details to
`.env` (see `.env.example` for the settings).

Two things to know:

**The link is the credential.** Anyone holding it can submit rates against that
lane, so treat it like an email address — it is not a secret worth panicking
about, but do not post it publicly. Links expire; 21 days is the default.

**Forwarders must be able to reach the machine.** A link pointing at
`192.168.1.42` only works inside your office. If you want forwarders to use it
from outside, that means exposing the tool to the internet, which is a bigger
decision than it sounds — see the next section. Until then, the copy-the-link
flow still saves the retyping, because you can paste the figures in yourself.

## Access from outside the office

Do **not** forward port 4000 on your router. That puts your rate cards on the
open internet behind nothing but a password.

If people need it from home, use [Tailscale](https://tailscale.com) — free for
small teams. Install it on the host machine and on each person's laptop, and
they reach the tool on its Tailscale address as if they were in the office. No
router changes, no exposed ports.

## Updating

```bash
git pull
npm install
npm run build
pm2 restart semcom-freight     # or stop and re-run `npm start`
```

Your database is untouched by an update. Take a backup first anyway.

## When something goes wrong

**"npm.ps1 cannot be loaded because running scripts is disabled"** — you are in
PowerShell. Open Command Prompt instead (Start, type `cmd`) and run the same
command there. Nothing is wrong with the install.

**"Your local changes to the following files would be overwritten by merge"** on
`git pull` — an earlier failed install edited `package-lock.json`. Run
`git checkout -- package-lock.json` to throw that edit away, then pull again.

**Sign-in fails right after setting up by hand** — a `.env` copied from
`.env.example` has no `JWT_SECRET`. Run `npm run setup`, which replaces an
unconfigured `.env` with a working one.

**Pages of red `gyp ERR!` text mentioning Visual Studio** — your Node version
has no pre-compiled database build, so npm tried to compile one. Install Node
22 or 24 from [nodejs.org](https://nodejs.org), then delete the `node_modules`
folder and run `npm install` again.

**"Could not read package.json"** — the folder is on the `main` branch, which
is empty. Run `git checkout claude/freight-estimate-container-tool-ryc7mq` in
that folder and try again.

**"Port 4000 is already in use"** — the tool is already running in another
window, or something else has the port. Close the other window, or set a
different port in `.env`.

**"Refusing to start in production"** — `.env` is missing or incomplete. Run
`npm run setup`.

**Signing in does nothing, or immediately signs you back out** — usually a
clock problem on the host machine; check its date and time are correct.

**Someone is locked out** — eight wrong passwords earns a 15 minute block.
Wait it out, or restart the tool to clear it.

**Forgotten admin password with no other admin** — the account cannot be
recovered from the outside. Ask whoever set it up; the password is in `.env` on
the host machine unless it was changed in the app.
