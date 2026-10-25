# Ручная загрузка реестра VID

Сайт VID пускает только мобильный интернет, поэтому робот не может скачать реестр сам.
Раз в неделю робот открывает issue «Laimex: что нужно сделать» с этой инструкцией, и GitHub
присылает письмо.

1. На телефоне выключите Wi-Fi и через мобильный интернет откройте
   https://www.vid.gov.lv/lv/loterijas, скачайте файл
   «Izsniegtās preču un pakalpojumu loteriju atļaujas» (.xls).
2. Загрузите его сюда: https://github.com/kosjak0ff/laimex5/upload/main/data/inbox
   и нажмите «Commit changes».

Робот запустится сам, возьмёт список лотерей из файла, удалит файл и обновит сайт.
