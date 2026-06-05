# `deploy/` — production deploy on a Linux VM

Reproducible deploy of Brief on a single VM. No secrets in this directory.

## What's here

- **Caddyfile** — reverse-proxy template that fronts `next start` on `:3000`
  and terminates HTTPS (Let's Encrypt). Substitutes `{$BRIEF_HOST}` at
  render time so the hostname doesn't live in git.
- **ecosystem.config.cjs** — PM2 config for the four long-running
  processes: `brief-web`, `brief-research`, `brief-treasury`,
  `brief-planner-service`. All four share the repo root + the same
  `.env.local`. Agents boot in `BRIEF_LLM_MODE=mock` so we don't burn
  LLM credits on a 24/7 deployment.
- **deploy.sh** — idempotent redeploy runbook (`bash deploy/deploy.sh`).

## First-time setup on a fresh VM

```bash
# 1. Provision a Linux VM. Ubuntu 24.04 LTS is what these scripts target.
#    Open inbound 22, 80, 443 in BOTH the OS firewall and the cloud
#    provider's security group / VCN security list.

# 2. Install Node 20+ (Node 22 LTS preferred), git, build tools, Caddy.
sudo apt-get update
sudo apt-get install -y curl git build-essential gettext caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Add a 2 GB swap file if memory is tight (< 2 GB RAM VMs — Next build
#    OOMs without it).
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Install pm2 globally.
sudo npm install -g pm2

# 5. Clone the repo.
git clone https://github.com/shariqazeem/brief.git ~/brief
cd ~/brief

# 6. Create .env.local with the production secrets (see ../.env.local.example).
#    NEVER commit this file. Make sure .gitignore covers it.

# 7. Set the public hostname for Caddy. sslip.io maps an IP-encoded
#    hostname to the IP automatically — useful when you don't own a
#    domain. e.g. for a VM at 1.2.3.4 you'd use 1-2-3-4.sslip.io.
export BRIEF_HOST="<your-host-here>"

# 8. Run the deploy script.
bash deploy/deploy.sh

# 9. Make pm2 + agents survive a reboot.
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save
```

## Subsequent redeploys

```bash
cd ~/brief
export BRIEF_HOST="<your-host>"  # only needed if the Caddyfile changed
bash deploy/deploy.sh
```

The script pulls `main`, runs `npm ci && npm run build`, restarts the
four PM2 processes, re-renders the Caddyfile if `$BRIEF_HOST` is set,
and reloads Caddy.

## Firewall — Oracle Cloud gotcha

Oracle Ubuntu cloud images apply a restrictive iptables config out of
the box, AND the Oracle VCN has its own Security List ingress rules.
You usually need BOTH:

```bash
# 1. OS-level — open 80 + 443 + persist the rule.
sudo iptables -I INPUT 6 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent netfilter-persistent
sudo netfilter-persistent save
```

```text
# 2. Cloud-level — add 0.0.0.0/0 ingress on TCP 80 + 443 to the VM's
#    subnet Security List (Oracle: Networking → Virtual Cloud Networks →
#    your VCN → Security Lists → Default Security List → Add Ingress Rule).
```

If `curl -I https://$BRIEF_HOST/` from outside the VM hangs but
`curl -I http://localhost:3000/` from inside the VM works, the cloud
security list almost certainly hasn't been opened yet.

## Verifying

```bash
pm2 status                     # 4 processes, all online
pm2 logs --lines 30            # recent activity
curl -I https://$BRIEF_HOST/   # 200 OK
sudo reboot                    # wait ~2 min, ssh back in, pm2 status — still online
```
