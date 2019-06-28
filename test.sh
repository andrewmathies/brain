#!/bin/bash

pkill node
rm nohup.out

nohup node index.js &
