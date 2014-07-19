#!/bin/sh

pushd ~/Movies/Save.TV

if [ -f savetv.lck ]; then
  exit 1
fi

echo `date '+%Y-%m-%d @ %H:%M:%S'` > lastrun.txt

touch savetv.lck

/usr/local/bin/node savetv.js -u  -p 

for i in *.avi 
do 
    /usr/local/bin/HandBrakeCLI -i "$i" -o "${i%%.*}.m4v"
done

for i in *.m4v 
do 
    /usr/local/bin/mp4tags -S Save.TV -i tvshow "$i"
    mv "${i%%.*}.avi" ~/.Trash/
done

/usr/bin/osascript iTunesImport.scpt 

rm savetv.lck

popd
