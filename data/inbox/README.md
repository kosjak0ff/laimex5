# Ручная загрузка реестра VID

Сюда можно загрузить файл реестра, если робот несколько дней не может скачать его сам
(тогда робот откроет issue «Laimex: что нужно сделать» с этой инструкцией).

1. Откройте https://www.vid.gov.lv/lv/loterijas и скачайте файл
   «Izsniegtās preču un pakalpojumu loteriju atļaujas» (.xls).
2. Загрузите его сюда: https://github.com/kosjak0ff/laimex5/upload/main/data/inbox
   и нажмите «Commit changes».

Робот запустится сам, возьмёт список лотерей из файла, удалит файл и обновит сайт.
