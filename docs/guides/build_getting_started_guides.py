#!/usr/bin/env python3
"""Build the bilingual ProgHard Link getting-started PDFs.

The French and English editions deliberately share one layout and one figure
list. Run from the repository root with:

    python docs/guides/build_getting_started_guides.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    Flowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
SHOT_ROOT = ROOT / "docs" / "assets" / "screenshots"
PAGE_W, PAGE_H = A4
BLUE = colors.HexColor("#1769AA")
DARK = colors.HexColor("#102238")
MUTED = colors.HexColor("#526474")
PALE = colors.HexColor("#EAF3FA")
GREEN = colors.HexColor("#17844A")
ORANGE = colors.HexColor("#C56B16")

FIGURES = [
    ("web-installer/01-home.png", "installer_home"),
    ("web-installer/02-install-confirmation.png", "installer_confirm"),
    ("web-installer/03-install-progress.png", "installer_progress"),
    ("web-installer/04-install-complete.png", "installer_done"),
    ("provisioning/01-setup-empty.png", "setup_empty"),
    ("provisioning/02-saved-restarting.png", "setup_saved"),
    ("provisioning/04-device-lan-page.png", "lan_page"),
    ("device-manager/01-login.png", "login"),
    ("device-manager/02-enrollment-confirmation.png", "enroll"),
    ("device-manager/03-device-claimed.png", "claimed"),
    ("device-manager/04-my-devices-online.png", "online"),
    ("remote-access/01-remote-device-ui.png", "remote"),
]

TEXT = {
"fr": {
"title": "ProgHard Link",
"subtitle": "Guide de démarrage",
"edition": "Version intermédiaire - installation et accès distant",
"intro": "Installez votre propre instance, flashez un ESP et ouvrez son interface à distance sans redirection de port vers l'appareil.",
"ten": "ProgHard Link en 10 minutes",
"ten_steps": ["VPS", "ProgHard Link", "Web Installer", "ESP", "Wi-Fi", "Register", "ONLINE", "Open"],
"ten_note": "Le premier déploiement du VPS prend naturellement plus de dix minutes. Une fois l'instance prête, ce parcours résume l'installation d'un appareil.",
"arch": "1. Comprendre l'architecture",
"arch_intro": "ProgHard Link est une pile auto-hébergée et local-first. L'ESP conserve sa propre interface HTTP sur le LAN. Pour l'accès distant, il ouvre un tunnel WebSocket sortant vers votre VPS.",
"arch_points": [
"Le navigateur utilise HTTPS jusqu'à Caddy sur le VPS.",
"Le serveur associe la requête au flux du tunnel de l'appareil.",
"Aucune redirection de port vers l'ESP n'est nécessaire.",
"L'interface locale reste utilisable sans Internet.",
],
"prereq": "2. Prérequis et versions",
"prereq_intro": "Ce guide cible un hobbyiste à l'aise avec un terminal et un domaine DNS. Il ne couvre pas encore Arduino ni OTA.",
"versions": [
["Composant", "Version publiée"], ["Server", "0.5.0"], ["ProgHard Link Base", "0.2.3"], ["Bibliothèque Arduino", "0.4.8"], ["Protocole tunnel", "espway-tunnel/2"],
],
"needs": ["Un VPS Ubuntu actuel avec accès sudo", "Un domaine et la possibilité de créer des enregistrements DNS", "Docker Engine et Docker Compose plugin", "Un ESP8266, ESP32 ou ESP32-C3 sacrificiel", "Un câble USB de données et Chrome ou Edge"],
"vps": "3. Installer le VPS",
"vps_intro": "Utilisez le dépôt public officiel. Les commandes ci-dessous reprennent le parcours minimal du repository ; consultez la documentation opérateur avant une exposition durable.",
"vps_commands": "git clone https://github.com/pdeprost-dot/ProgHard-Link.git /opt/proghard-link\ncd /opt/proghard-link\ncp .env.example .env\nchmod 600 .env\n# Éditer .env, puis :\nsudo docker compose config\nsudo docker compose build\nsudo docker compose pull\nsudo docker compose up -d\nsudo docker compose ps",
"vps_warn": "Ne lancez jamais docker compose down -v sur une instance réelle : cette commande supprime les volumes persistants.",
"dns": "4. DNS, HTTPS et premier administrateur",
"dns_intro": "Créez un enregistrement A pour l'apex et un wildcard vers le VPS. Le wildcard ne couvre pas l'apex.",
"dns_box": "link.example.com              → VPS_IPV4\n*.link.example.com            → VPS_IPV4\nadmin.link.example.com        → Device Manager\ninstall.link.example.com      → Web Installer\ntunnel.link.example.com       → tunnel sortant\nesp-xxxxxx.link.example.com   → accès appareil",
"admin": "Créez ensuite le premier administrateur. Le mot de passe est demandé deux fois de manière masquée : ne le placez jamais dans la ligne de commande.",
"admin_cmd": "cd /opt/proghard-link\nsudo docker compose exec server npm run create-admin -- --username admin",
"installer": "5. Installer ProgHard Link Base",
"installer_intro": "Ouvrez https://install.link.example.com/ dans Chrome ou Edge, connectez l'ESP avec un câble de données, puis choisissez Install ProgHard Link.",
"installer_steps": ["Sélectionnez le port série de l'ESP.", "Confirmez ProgHard Link Base 0.2.3 et l'effacement de l'appareil.", "Gardez la page visible pendant l'écriture.", "Lorsque l'installation est terminée, passez au provisioning Wi-Fi."],
"provision": "6. Provisionner le Wi-Fi",
"provision_intro": "Après le redémarrage, rejoignez le point d'accès ESPway-XXXXXX. Le portail captif devrait s'ouvrir ; sinon visitez http://192.168.4.1/.",
"provision_steps": ["Donnez un nom clair à l'appareil.", "Saisissez le SSID et le mot de passe Wi-Fi.", "Laissez Remote access activé si vous souhaitez l'accès distant.", "Renseignez l'URL complète de l'instance, par exemple https://link.example.com.", "Choisissez Save & Restart, puis rejoignez à nouveau votre LAN."],
"enrollment": "7. Enregistrer l'appareil",
"enroll_intro": "Sur le LAN, essayez d'abord http://esp-xxxxxx/. La page locale indique l'état Wi-Fi et tunnel. Choisissez Register this device in ProgHard Link.",
"enroll_steps": ["Authentifiez-vous dans le Device Manager si nécessaire.", "Vérifiez le nom, le matériel, l'application et le Device ID.", "Confirmez Register device.", "La page de succès confirme l'association au compte."],
"manager": "8. Vérifier ONLINE dans Device Manager",
"manager_intro": "Revenez à My devices. Une seule fiche doit apparaître. L'état ONLINE et le bouton Open confirment que le tunnel est disponible.",
"remote_title": "9. Ouvrir l'interface distante",
"remote_intro": "Utilisez toujours My devices → Open. Le Device Manager crée un ticket d'accès court et à usage unique, puis le navigateur rejoint le nom HTTPS de l'appareil.",
"remote_note": "Ouvrir directement l'URL wildcard sans autorisation peut produire 401 authentication required. C'est attendu : revenez au Device Manager et utilisez Open.",
"trouble": "10. Dépannage de base",
"troubles": [
["Le portail ne s'ouvre pas", "Ouvrez http://192.168.4.1/ après avoir rejoint ESPway-XXXXXX."],
["L'appareil reste OFFLINE", "Vérifiez le Wi-Fi, l'URL d'instance, le DNS de tunnel.link.example.com et l'heure du système."],
["device_already_registered", "Une autorisation existe déjà pour ce Device ID. Vérifiez l'ancienne association et ne la supprimez que si le nouvel enrollment est intentionnel."],
["401 sur l'URL appareil", "Retournez dans My devices et utilisez Open afin d'obtenir un ticket valide."],
["TLS ou DNS échoue", "Vérifiez l'apex, le wildcard et l'accès public aux ports TCP 80 et 443 avant de diagnostiquer Caddy."],
],
"ops": "Pour les sauvegardes, mises à niveau, règles de sécurité et diagnostics avancés, consultez docs/backup-restore.md, docs/upgrading.md, docs/security.md et docs/vps-installation.md.",
"end": "Vous avez maintenant un ESP local-first, enregistré dans votre Device Manager et accessible à distance par HTTPS.",
"later": "Arduino et OTA seront ajoutés dans une prochaine édition.",
"fig": "Figure",
"captions": {
"installer_home":"Accueil du Web Installer et plateformes prises en charge.", "installer_confirm":"Confirmation de l'installation de Base 0.2.3.", "installer_progress":"Écriture réelle du firmware dans le navigateur.", "installer_done":"Installation terminée.", "setup_empty":"Formulaire de provisioning avant saisie des secrets Wi-Fi.", "setup_saved":"Configuration enregistrée et redémarrage de l'ESP.", "lan_page":"Page LAN avant enrollment : Wi-Fi connecté, tunnel encore déconnecté.", "login":"Authentification humaine du Device Manager.", "enroll":"Confirmation de l'appareil à enregistrer.", "claimed":"Association réussie avec le compte.", "online":"Appareil ONLINE, firmware à jour et action Open disponible.", "remote":"Interface réelle obtenue à distance via My devices → Open.",
},
},
"en": {
"title": "ProgHard Link",
"subtitle": "Getting Started Guide",
"edition": "Intermediate edition - installation and remote access",
"intro": "Deploy your own instance, flash an ESP, and open its interface remotely without forwarding a port to the device.",
"ten": "ProgHard Link in 10 minutes",
"ten_steps": ["VPS", "ProgHard Link", "Web Installer", "ESP", "Wi-Fi", "Register", "ONLINE", "Open"],
"ten_note": "The first VPS deployment naturally takes longer than ten minutes. Once the instance is ready, this path summarizes device installation.",
"arch": "1. Understand the architecture",
"arch_intro": "ProgHard Link is a self-hosted, local-first stack. The ESP owns its HTTP interface on the LAN. For remote access, it opens an outbound WebSocket tunnel to your VPS.",
"arch_points": ["The browser uses HTTPS to Caddy on the VPS.", "The server maps the request to the device tunnel stream.", "No port forwarding to the ESP is required.", "The local interface remains usable without Internet access."],
"prereq": "2. Requirements and versions",
"prereq_intro": "This guide is for hobbyists comfortable with a terminal and DNS. Arduino and OTA are not included yet.",
"versions": [["Component", "Published version"], ["Server", "0.5.0"], ["ProgHard Link Base", "0.2.3"], ["Arduino library", "0.4.8"], ["Tunnel protocol", "espway-tunnel/2"]],
"needs": ["A current Ubuntu VPS with sudo access", "A domain and permission to create DNS records", "Docker Engine and the Docker Compose plugin", "A sacrificial ESP8266, ESP32, or ESP32-C3", "A USB data cable and Chrome or Edge"],
"vps": "3. Install the VPS",
"vps_intro": "Use the official public repository. The commands below follow its minimal path; read the operator documentation before long-term public exposure.",
"vps_commands": "git clone https://github.com/pdeprost-dot/ProgHard-Link.git /opt/proghard-link\ncd /opt/proghard-link\ncp .env.example .env\nchmod 600 .env\n# Edit .env, then run:\nsudo docker compose config\nsudo docker compose build\nsudo docker compose pull\nsudo docker compose up -d\nsudo docker compose ps",
"vps_warn": "Never run docker compose down -v on a real instance: it deletes persistent volumes.",
"dns": "4. DNS, HTTPS, and the first administrator",
"dns_intro": "Create one A record for the apex and one wildcard record pointing to the VPS. The wildcard does not cover the apex.",
"dns_box": "link.example.com              → VPS_IPV4\n*.link.example.com            → VPS_IPV4\nadmin.link.example.com        → Device Manager\ninstall.link.example.com      → Web Installer\ntunnel.link.example.com       → outbound tunnel\nesp-xxxxxx.link.example.com   → device access",
"admin": "Then create the first administrator. The password is requested twice with masked input: never place it on the command line.",
"admin_cmd": "cd /opt/proghard-link\nsudo docker compose exec server npm run create-admin -- --username admin",
"installer": "5. Install ProgHard Link Base",
"installer_intro": "Open https://install.link.example.com/ in Chrome or Edge, connect the ESP with a data cable, and choose Install ProgHard Link.",
"installer_steps": ["Select the ESP serial port.", "Confirm ProgHard Link Base 0.2.3 and device erasure.", "Keep the page visible while the firmware is written.", "When installation completes, continue with Wi-Fi provisioning."],
"provision": "6. Provision Wi-Fi",
"provision_intro": "After restart, join the ESPway-XXXXXX access point. The captive portal should open; otherwise visit http://192.168.4.1/.",
"provision_steps": ["Give the device a clear name.", "Enter the Wi-Fi SSID and password.", "Leave Remote access enabled if you want remote access.", "Enter the complete instance URL, for example https://link.example.com.", "Choose Save & Restart, then rejoin your LAN."],
"enrollment": "7. Register the device",
"enroll_intro": "On the LAN, try http://esp-xxxxxx/ first. The local page reports Wi-Fi and tunnel state. Choose Register this device in ProgHard Link.",
"enroll_steps": ["Sign in to Device Manager if required.", "Check the name, hardware, application, and Device ID.", "Confirm Register device.", "The success page confirms association with the account."],
"manager": "8. Confirm ONLINE in Device Manager",
"manager_intro": "Return to My devices. Exactly one card should be present. ONLINE state and the Open button confirm that the tunnel is available.",
"remote_title": "9. Open the remote interface",
"remote_intro": "Always use My devices → Open. Device Manager creates a short-lived, single-use access ticket before the browser reaches the device HTTPS hostname.",
"remote_note": "Opening the wildcard device URL directly without authorization may return 401 authentication required. This is expected: return to Device Manager and use Open.",
"trouble": "10. Basic troubleshooting",
"troubles": [["The portal does not open", "Open http://192.168.4.1/ after joining ESPway-XXXXXX."], ["The device remains OFFLINE", "Check Wi-Fi, the instance URL, DNS for tunnel.link.example.com, and system time."], ["device_already_registered", "An authorization already exists for this Device ID. Review the old association and delete it only when the new enrollment is intentional."], ["401 on the device URL", "Return to My devices and use Open to obtain a valid ticket."], ["TLS or DNS fails", "Check the apex, wildcard, and public TCP ports 80 and 443 before troubleshooting Caddy."]],
"ops": "For backups, upgrades, security rules, and advanced diagnostics, see docs/backup-restore.md, docs/upgrading.md, docs/security.md, and docs/vps-installation.md.",
"end": "You now have a local-first ESP registered in Device Manager and remotely accessible over HTTPS.",
"later": "Arduino and OTA will be added in a later edition.",
"fig": "Figure",
"captions": {"installer_home":"Web Installer home page and supported platforms.", "installer_confirm":"Confirmation for installing Base 0.2.3.", "installer_progress":"Real browser-based firmware write in progress.", "installer_done":"Installation completed.", "setup_empty":"Provisioning form before entering Wi-Fi secrets.", "setup_saved":"Configuration saved and ESP restarting.", "lan_page":"LAN page before enrollment: Wi-Fi connected, tunnel not connected yet.", "login":"Human authentication for Device Manager.", "enroll":"Confirmation of the device to register.", "claimed":"Successful association with the account.", "online":"Device ONLINE, firmware current, and Open available.", "remote":"Real remote interface reached through My devices → Open."},
},
}


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf"), Path("C:/Windows/Fonts/consola.ttf")),
        (Path("C:/Windows/Fonts/segoeui.ttf"), Path("C:/Windows/Fonts/segoeuib.ttf"), Path("C:/Windows/Fonts/consola.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")),
    ]
    for regular, bold, mono in candidates:
        if regular.exists() and bold.exists() and mono.exists():
            pdfmetrics.registerFont(TTFont("GuideSans", str(regular)))
            pdfmetrics.registerFont(TTFont("GuideSansBold", str(bold)))
            pdfmetrics.registerFont(TTFont("GuideMono", str(mono)))
            return "GuideSans", "GuideSansBold", "GuideMono"
    return "Helvetica", "Helvetica-Bold", "Courier"


FONT, FONT_BOLD, FONT_MONO = register_fonts()


class TenMinuteDiagram(Flowable):
    def __init__(self, labels):
        super().__init__(); self.labels = labels; self.width = 170*mm; self.height = 82*mm
    def draw(self):
        c = self.canv; cols = 4; box_w = 36*mm; box_h = 17*mm; gap_x = 6*mm; gap_y = 15*mm
        for i, label in enumerate(self.labels):
            row, col = divmod(i, cols); x = col*(box_w+gap_x); y = self.height-box_h-row*(box_h+gap_y)
            c.setFillColor(PALE if i not in (6,7) else colors.HexColor("#DDF4E8")); c.setStrokeColor(BLUE); c.roundRect(x,y,box_w,box_h,3*mm,fill=1,stroke=1)
            c.setFillColor(DARK); c.setFont(FONT_BOLD,10); c.drawCentredString(x+box_w/2,y+6.5*mm,label)
            if col < cols-1: c.setStrokeColor(MUTED); c.line(x+box_w,y+box_h/2,x+box_w+gap_x-1*mm,y+box_h/2)
        c.setStrokeColor(MUTED); c.line(self.width-18*mm,self.height-17*mm,self.width-18*mm,self.height-32*mm)


class TunnelDiagram(Flowable):
    def __init__(self): super().__init__(); self.width=170*mm; self.height=58*mm
    def draw(self):
        c=self.canv; xs=[2*mm,64*mm,126*mm]; labels=["ESP", "ProgHard Link VPS", "Browser"]
        for x,label in zip(xs,labels):
            c.setFillColor(PALE); c.setStrokeColor(BLUE); c.roundRect(x,18*mm,42*mm,22*mm,3*mm,fill=1,stroke=1)
            c.setFillColor(DARK); c.setFont(FONT_BOLD,10); c.drawCentredString(x+21*mm,27*mm,label)
        c.setStrokeColor(GREEN); c.setLineWidth(2); c.line(44*mm,29*mm,63*mm,29*mm); c.line(106*mm,29*mm,125*mm,29*mm)
        c.setFillColor(MUTED); c.setFont(FONT,8); c.drawCentredString(54*mm,34*mm,"outbound tunnel"); c.drawCentredString(116*mm,34*mm,"HTTPS")
        c.setFillColor(GREEN); c.drawString(82*mm,7*mm,"No port forwarding to the ESP")


def styles():
    base=getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontName=FONT_BOLD, fontSize=34, leading=38, textColor=DARK, alignment=TA_LEFT, spaceAfter=5*mm),
        "subtitle": ParagraphStyle("subtitle", parent=base["Heading2"], fontName=FONT_BOLD, fontSize=21, leading=25, textColor=BLUE, spaceAfter=8*mm),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=FONT_BOLD, fontSize=22, leading=27, textColor=DARK, spaceAfter=6*mm),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=FONT_BOLD, fontSize=14, leading=18, textColor=BLUE, spaceBefore=3*mm, spaceAfter=3*mm),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName=FONT, fontSize=10.5, leading=15, textColor=DARK, spaceAfter=3*mm),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontName=FONT, fontSize=8.5, leading=11, textColor=MUTED),
        "caption": ParagraphStyle("caption", parent=base["BodyText"], fontName=FONT, fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2*mm, spaceAfter=4*mm),
        "code": ParagraphStyle("code", parent=base["Code"], fontName=FONT_MONO, fontSize=8.3, leading=11, textColor=DARK, backColor=colors.HexColor("#F3F6F8"), borderPadding=7, spaceBefore=2*mm, spaceAfter=4*mm),
        "callout": ParagraphStyle("callout", parent=base["BodyText"], fontName=FONT, fontSize=10, leading=14, textColor=DARK, backColor=PALE, borderColor=BLUE, borderWidth=0.8, borderPadding=8, spaceBefore=3*mm, spaceAfter=4*mm),
    }


def para(text, s, style="body"): return Paragraph(text.replace("\n","<br/>"), s[style])


def bullets(items, s):
    return ListFlowable([ListItem(para(x,s), leftIndent=4*mm) for x in items], bulletType="bullet", leftIndent=6*mm, bulletFontName=FONT, bulletFontSize=8, spaceAfter=4*mm)


def figure(index, rel, key, t, s, max_h=92*mm):
    path=SHOT_ROOT/rel
    with PILImage.open(path) as im: w,h=im.size
    max_w=170*mm; scale=min(max_w/w,max_h/h)
    img=Image(str(path),width=w*scale,height=h*scale)
    cap=para(f"{t['fig']} {index}. {t['captions'][key]}",s,"caption")
    return KeepTogether([img,cap])


def header_footer(canvas, doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E2EA")); canvas.line(20*mm,18*mm,PAGE_W-20*mm,18*mm)
    canvas.setFont(FONT,8); canvas.setFillColor(MUTED); canvas.drawString(20*mm,11*mm,"ProgHard Link")
    canvas.drawRightString(PAGE_W-20*mm,11*mm,str(doc.page)); canvas.restoreState()


def section(story, title, s): story.extend([PageBreak(),para(title,s,"h1")])


def build(lang, output):
    t=TEXT[lang]; s=styles(); story=[]; fig_no={key:i+1 for i,(_,key) in enumerate(FIGURES)}
    story += [Spacer(1,25*mm),para(t["title"],s,"title"),para(t["subtitle"],s,"subtitle"),Spacer(1,8*mm),para(t["intro"],s),Spacer(1,12*mm),para(t["edition"],s,"callout"),Spacer(1,50*mm),para("Server 0.5.0 · Base 0.2.3 · Arduino library 0.4.8 · espway-tunnel/2",s,"small")]
    section(story,t["ten"],s); story += [TenMinuteDiagram(t["ten_steps"]),Spacer(1,5*mm),para(t["ten_note"],s,"callout")]
    section(story,t["arch"],s); story += [para(t["arch_intro"],s),Spacer(1,5*mm),TunnelDiagram(),bullets(t["arch_points"],s)]
    section(story,t["prereq"],s); story += [para(t["prereq_intro"],s),bullets(t["needs"],s),Table(t["versions"],colWidths=[90*mm,70*mm],style=TableStyle([("BACKGROUND",(0,0),(-1,0),BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),FONT),("FONTNAME",(0,0),(-1,0),FONT_BOLD),("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#CBD6DE")),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F5F8FA")]),("PADDING",(0,0),(-1,-1),7)]))]
    section(story,t["vps"],s); story += [para(t["vps_intro"],s),para(t["vps_commands"],s,"code"),para(t["vps_warn"],s,"callout"),para("ESPWAY_DOMAIN=link.example.com<br/>ACME_EMAIL=admin@example.net<br/>ESPWAY_OTA_OPERATOR_TOKEN=",s,"code")]
    section(story,t["dns"],s); story += [para(t["dns_intro"],s),para(t["dns_box"],s,"code"),para(t["admin"],s),para(t["admin_cmd"],s,"code")]
    section(story,t["installer"],s); story += [para(t["installer_intro"],s),bullets(t["installer_steps"],s),figure(fig_no["installer_home"],*FIGURES[0],t,s,76*mm),figure(fig_no["installer_confirm"],*FIGURES[1],t,s,76*mm)]
    story += [PageBreak(),figure(fig_no["installer_progress"],*FIGURES[2],t,s,92*mm),figure(fig_no["installer_done"],*FIGURES[3],t,s,92*mm)]
    section(story,t["provision"],s); story += [para(t["provision_intro"],s),bullets(t["provision_steps"],s),figure(fig_no["setup_empty"],*FIGURES[4],t,s,82*mm),figure(fig_no["setup_saved"],*FIGURES[5],t,s,60*mm)]
    story += [PageBreak(),figure(fig_no["lan_page"],*FIGURES[6],t,s,190*mm)]
    section(story,t["enrollment"],s); story += [para(t["enroll_intro"],s),bullets(t["enroll_steps"],s),figure(fig_no["login"],*FIGURES[7],t,s,82*mm),figure(fig_no["enroll"],*FIGURES[8],t,s,82*mm)]
    story += [PageBreak(),figure(fig_no["claimed"],*FIGURES[9],t,s,185*mm)]
    section(story,t["manager"],s); story += [para(t["manager_intro"],s),figure(fig_no["online"],*FIGURES[10],t,s,178*mm)]
    section(story,t["remote_title"],s); story += [para(t["remote_intro"],s),para(t["remote_note"],s,"callout"),figure(fig_no["remote"],*FIGURES[11],t,s,172*mm)]
    section(story,t["trouble"],s); data=[[para(a,s,"h2"),para(b,s)] for a,b in t["troubles"]]; story += [Table(data,colWidths=[53*mm,107*mm],style=TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBELOW",(0,0),(-1,-2),0.4,colors.HexColor("#D9E2EA")),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)])),Spacer(1,8*mm),para(t["ops"],s,"callout"),Spacer(1,10*mm),para(t["end"],s,"h2"),para(t["later"],s,"small")]
    doc=SimpleDocTemplate(str(output),pagesize=A4,rightMargin=20*mm,leftMargin=20*mm,topMargin=20*mm,bottomMargin=23*mm,title=f"{t['title']} - {t['subtitle']}",author="ProgHard Link contributors",subject=t["edition"])
    doc.build(story,onFirstPage=header_footer,onLaterPages=header_footer)


def main():
    missing=[str(SHOT_ROOT/p) for p,_ in FIGURES if not (SHOT_ROOT/p).is_file()]
    if missing: raise SystemExit("Missing screenshots:\n"+"\n".join(missing))
    build("fr",ROOT/"docs"/"ProgHard-Link-Guide-demarrage-FR.pdf")
    build("en",ROOT/"docs"/"ProgHard-Link-Getting-Started-EN.pdf")


if __name__ == "__main__": main()
