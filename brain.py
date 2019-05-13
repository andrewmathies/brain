import serial
import time
import requests
import csv

from oven import Oven

# run an infinite loop, every second wake up, read csv file into a dict, compare to current record we have
# if anything changed then write the new version file to that device

oldRecords = dict()
records = dict()

def writeToUSB(key):
    filename = records[key].version.replace('.', '_') + '_walloven.tar.xz.enc'
    writeFilePath = '/home/andrew/usb/' + filename
    readFilePath = '/home/andrew/versions/' + filename

    print 'writing new version to ', records[key]
    print 'readFilePath: ', readFilePath, '\nwriteFilePath: ', writeFilePath

    with open(readFilePath) as readFile, open(writeFilePath, 'w+') as writeFile:
        writeFile.write(readFile.read())

    print 'wrote file to usb'

def parseDict(isFirst):
    with open('dict.csv') as csvFile:
        reader = csv.reader(csvFile, delimiter=',')

        for row in reader:
            #print 'id: ', row[0], ' model: ', row[1], ' current version: ', row[2]
            records[row[0]] = Oven(row[1], row[2]) 
            if isFirst:
                oldRecords[row[0]] = Oven(row[1], row[2])

        for key in records:
            if oldRecords[key].version != records[key].version:
                oldRecords[key] = records[key]
                writeToUSB(key)

        time.sleep(10)

def downloadDict(isFirst):
    download = requests.get('http://saturten.com/sbc/versions.csv')
    decodedContent = download.content.decode('utf-8')
    
    with open('dict.csv', 'w') as writeFile:
        writeFile.write(decodedContent)

    parseDict(isFirst)

print 'starting brain'
downloadDict(True)

while True:
    print 'loop iteration'
    downloadDict(False)
