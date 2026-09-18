# Prompt IA pour développer une application ProgHard Link

Copiez le prompt ci-dessous dans une nouvelle conversation avec votre agent de
développement, puis complétez seulement les informations que vous connaissez.
Une simple phrase de description peut suffire.

```text
Tu vas développer une application compatible ProgHard Link à partir du dépôt
public officiel :

https://github.com/pdeprost-dot/ProgHard-Link

Le dépôt actuel est la source de vérité. Commence par l'inspecter avant de
proposer ou modifier du code. Lis intégralement
docs/application-development.md, puis consulte README.md, la documentation OTA
actuelle et les exemples Arduino pertinents pour la cible et les fonctions
demandées. Respecte le contrat de développement ProgHard Link documenté dans
le dépôt. Ne te base pas sur une ancienne copie du projet ni sur des
suppositions qui contredisent le code actuel.

APPLICATION À DÉVELOPPER

- Description : [une phrase suffit]
- Carte / MCU : [facultatif]
- Matériel connecté : [facultatif]
- Interface utilisateur souhaitée : [facultatif]
- API applicative : [facultatif]
- MQTT : [facultatif]
- Paramètres persistants : [facultatif]
- Contraintes particulières : [facultatif]

Travaille de manière autonome : inspecte, développe, compile, teste, corrige
et reteste. Utilise le terminal, le navigateur et le matériel réel lorsque ton
environnement le permet. Ne demande à l'utilisateur que les actions humaines
réellement indispensables et ne redemande pas une information déjà disponible
dans le dépôt ou l'environnement.

Réutilise le framework et les services ProgHard Link existants au lieu de
recréer le Wi-Fi, le provisioning, l'identité, l'enrollment, le tunnel, HTTP,
l'authentification, MQTT, la persistance ou l'OTA. Intègre toute page
applicative importante à la navigation conformément au contrat. Utilise les
mécanismes d'authentification documentés et, lorsqu'un client externe doit
accéder à une API distante, le PAT prévu à cet effet. Le Device Token est un
secret interne : ne le demande jamais à l'utilisateur et ne l'expose pas.

Préserve le Device ID, le Device Token, le Wi-Fi, l'enrollment, l'ownership et
la configuration lors des mises à jour normales. N'effectue jamais de full
erase simplement pour déployer une nouvelle version applicative. Utilise l'OTA
distante actuelle de ProgHard Link depuis le Device Manager lorsqu'elle est
disponible. Isole raisonnablement le code spécifique au matériel du code
applicatif. Réutilise en priorité les mécanismes existants, mais considère
aussi le développement d'applications comme un moyen d'identifier et
d'améliorer les capacités génériques du framework. Si l'application révèle une
fonction générique manquante, une limitation ou une incohérence, analyse-la et
améliore le framework lorsque cette solution est préférable à un contournement
spécifique à l'application. Préserve autant que raisonnablement possible la
compatibilité avec les applications existantes et ajoute les tests appropriés.

Compile et teste pour la cible réelle. Ne prétends jamais qu'une validation
matérielle a réussi si elle n'a pas réellement été exécutée. Reste économe en
contexte : lis les fichiers du dépôt directement, évite les longues explications
intermédiaires et rapporte surtout les décisions importantes, les blocages et
les résultats.

Avant de considérer le travail terminé :

1. compile l'application pour la cible prévue ;
2. exécute les tests et validations pertinents ;
3. vérifie le diff et l'absence de secrets ou d'artefacts temporaires ;
4. si possible, installe le .bin par l'OTA ProgHard Link sans full erase ;
5. vérifie le reboot, le retour ONLINE, l'application, et la conservation de
   l'identité, de l'enrollment et de la configuration ;
6. fournis un rapport final concis avec les tests réellement exécutés, les
   tailles de build, la validation matérielle éventuelle et les limites
   restantes.

Ne committe et ne pousse rien sans autorisation explicite de l'utilisateur.
```
