#!/usr/bin/env bash

if [ -z $1 ]
then
    echo Invalid parameters:
    echo tagit.sh \<mp4 media file\>
	exit 1
fi

export METAFILE=$1.meta

if [ ! -f $1 ]
then
    echo Missing media file
	exit 1
fi

if [ ! -f $METAFILE ]
then
    echo Missing metadata file
	exit 1
fi

export TVSTATION="$(node meta.js $METAFILE STVSTATIONNAME)"
export EPISODE="$(node meta.js $METAFILE SFOLGE)"
export TITLE="$(node meta.js $METAFILE SSUBTITLE)"
export SHOW="$(node meta.js $METAFILE STITLE)"

if [ -z "$EPISODE" ] ; then EPISODE=1 ; fi
if [ -z "$TITLE" ] ; then TITLE="$SHOW" ; fi

echo tagging file $1 =\> $SHOW \| $TITLE
mp4tags -r A --show "$SHOW" -s "$TITLE" -network "$TVSTATION" "$1"

if [ $? -eq 0 ]; then
    rm "$METAFILE"
else
    echo Error updating tags on $1
    exit 1
fi