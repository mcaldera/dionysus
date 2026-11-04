Forum threads (e.g. Reddit r/wien) for bar tips. Reddit blocks automated access, so:

1. Open the thread in your browser and expand the comments ("more replies").
2. Select all (Ctrl+A), copy, and paste into a new .txt file here, one file per thread.
3. Put the thread URL on the very first line.

Then ask Claude to process the tips. It runs pipeline/forum_mentions.py, reads the threads,
records each recommended place with what it is praised for (guenstig, urig, rau, atzig),
skips warnings ("geht da nicht hin"), and appends rows to ../tips.csv with the thread as
source. Your files stay local (data/own/tips is not published); only bar names, the thread
title and URL, and the kind go into the site.
