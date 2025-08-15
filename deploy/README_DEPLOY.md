# loy guide — merceariarv.app (NGINX + Certbot + systemd)

Overview

- This guide shows how to deploy the frontend + backend on a public server with a valid TLS certificate (Let's Encrypt) and run the Spring Boot JAR as a systemd service.

Prereqs

- A public server with a public IP and SSH access (Ubuntu/Debian recommended)
- Domain `merceariarv.app` pointed to that IP (A record)
- Ports 80 and 443 allowed/forwarded to the server

Steps

1) Prepare server

- SSH to the server as a user with sudo privileges.
- Update packages: sudo apt update && sudo apt upgrade -y

1) Copy artifacts

- Copy frontend build (folder `frontend/dist/sistema-estoque/browser`) to the server.
- Place it somewhere accessible, e.g. /srv/deploy/frontend or upload to /tmp.
- Copy the backend jar (backend-spring/target/backend-spring-0.0.1-SNAPSHOT.jar) to /opt/backend/
  - sudo mkdir -p /opt/backend
  - sudo cp backend-spring-0.0.1-SNAPSHOT.jar /opt/backend/
  - sudo chown -R root:root /opt/backend

1) Install nginx + certbot and configure site (script)

- If you want the automated approach, run the provided script (edit email first):
  - sudo bash /root/deploy/scripts/setup_nginx_certbot.sh /path/to/browser
- The script will:
  - install nginx and certbot
  - copy frontend files to /var/www/merceariarv.app
  - install nginx site config (/etc/nginx/sites-available/merceariarv.app)
  - request a Let's Encrypt certificate with certbot

1) Install systemd unit for backend

- Copy the unit file and enable service:
  - sudo cp deploy/systemd/backend-spring.service /etc/systemd/system/backend-spring.service
  - (Optional) create environment file /etc/default/backend-spring to set JAVA_OPTS or other envs
    - Example /etc/default/backend-spring:
      JAVA_OPTS="-Xms128m -Xmx512m"
  - Reload and start:
    - sudo systemctl daemon-reload
    - sudo systemctl enable --now backend-spring
  - Check status: sudo journalctl -u backend-spring -f

1) Verify

- Check nginx: sudo systemctl status nginx
- Open: <https://merceariarv.app> (should load frontend)
- Health: <https://merceariarv.app/api/health> (proxied to backend)

1) SSL renewal

- Certbot installs a timer for automatic renewal. Test with:
  - sudo certbot renew --dry-run

Notes and troubleshooting

- If port 80/443 blocked, the certificate issuance will fail. Use DNS and firewall config first.
- If backend fails to start, inspect logs: sudo journalctl -u backend-spring -e
- Ensure user/service permissions are correct; you may change User= in the unit to a dedicated service user.
