#!/bin/sh

if [ -f savetv.lck ]; then
  now=`date +%s`
  last=`cat savetv.lck`
  diff=$((${now} - ${last}))
  if (($diff < 21600)); then
    exit 1
  fi
fi

echo `date '+%s'` > savetv.lck
echo `date '+%s'` > lastrun.txt

node savetv.js -u ${SAVE_TV_USERID} -p ${SAVE_TV_PASSWORD}

for i in download/*.mp4
do
    ./tag.sh "$i" && mv "$i" drop
done

rm savetv.lck
