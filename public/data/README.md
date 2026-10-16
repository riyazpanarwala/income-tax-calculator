# AMFI historical NAV reference

`amfi-nav-2018-01-31.txt` is the unmodified public AMFI NAV file downloaded on 16 October 2026 from:

https://www.amfiindia.com/uploads/NAV_All_31_Jan2018_cf117d62c0.txt

SHA-256 of downloaded bytes: `50941F7A6D13647764243EEE574E7FAD8A4631A58E7C18EDF7FBF6C3C43428CD`.

The app reads only rows dated `31-Jan-2018`, matches exact plan/option ISINs, and keeps all NAV decimals. Rows for other dates, invalid NAVs and conflicting matches are not used. It loads this file from its own static hosting path; portfolio data is never sent to AMFI. The snapshot is a historical reference and does not require daily updates. Review a replacement file and rerun the importer tests before changing it.
