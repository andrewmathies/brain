#!/bin/bash

rm /home/andrew/git/socket/nohup.out
echo "removed old log file"

sudo pkill node
echo "killed old socket process"

nohup sudo node socket.js &
echo "started new socket"
