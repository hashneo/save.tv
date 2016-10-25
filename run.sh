#!/bin/sh

#pushd /Volumes/Data/Movies/Save.TV 

if [ -f savetv.lck ]; then
  now=`date +%s`
  last=`cat savetv.lck`
  diff=$((${now} - ${last}))
  if (($diff < 21600)); then
  	popd
    exit 1
  fi
fi

echo `date '+%s'` > savetv.lck
echo `date '+%s'` > lastrun.txt

/usr/local/bin/node savetv.js -u ${SAVE_TV_USERID} -p ${SAVE_TV_PASSWORD}

for i in *.avi 
do 
    aviFile=${i%%.*}.avi
    m4vFile=${i%%.*}.m4v
    mp4File=${i%%.*}.mp4
	
    if [ -f "$m4vFile" ]; then
        rm "$m4vFile"
    fi

    /usr/local/bin/HandBrakeCLI -i "$aviFile" -o "$m4vFile"

    if [ -f “$mp4File” ]; then mv “$mp4File” “$m4vFile”; fi

    /usr/local/bin/mp4tags -S Save.TV -i tvshow "$m4vFile" && mv "$aviFile" ~/.Trash/

done

/usr/bin/osascript iTunesImport.scpt

rm savetv.lck

#popd
