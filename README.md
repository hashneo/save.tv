save.tv
=======

Allows you do download your recordings on the German Save.TV site.

Installation
============

- Create a directory
- copy savetv.js into directory
- run npm install
- run program

If you want to run it automatically, update run.sh and Save.TV.plist with the correct paths and use: 

launchctl load -w Save.TV.plist

this should run the script every hour, getting the latest shows.

Script Depends on 
- HandBrakeCLI
- mp4tags

use Brew to install them (/usr/local/bin)

Usage
=====

node savetv.js -u username -p password

