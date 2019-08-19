#!/bin/bash

mqtt publish -t 'unit/80812647/' -h 'saturten.com' -p 8883 -C 'mqtts' -m '{ "Header": "Hello", "Version": "2.27" }' -u 'andrew' -P '1plus2is3'
mqtt publish -t 'unit/62172354/' -h 'saturten.com' -p 8883 -C 'mqtts' -m '{ "Header": "Hello", "Version": "3.31" }' -u 'andrew' -P '1plus2is3'
mqtt publish -t 'unit/23798610/' -h 'saturten.com' -p 8883 -C 'mqtts' -m '{ "Header": "Hello", "Version": "3.30" }' -u 'andrew' -P '1plus2is3'
mqtt publish -t 'unit/80815216/' -h 'saturten.com' -p 8883 -C 'mqtts' -m '{ "Header": "Hello", "Version": "2.27" }' -u 'andrew' -P '1plus2is3'
