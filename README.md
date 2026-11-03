# Ruby Glove

GitHub Pages frontend for the ESP32 sign-language glove. The published page connects to the ESP32 directly using Web Serial; it does not need `py app.py`.

## Collecting gesture samples

1. Open `https://nora0bm9-dot.github.io/Rube_golve/` in Chrome or Edge.
2. Connect the ESP32, choose a gesture label, and keep the default batch size of 20 (or change it).
3. Perform the gesture for each 2-second sample and press Enter between samples.
4. Samples are learned immediately and saved in this browser's local storage. Use **Export CSV** to download a backup.

GitHub Pages is static hosting. Samples recorded in the page are not uploaded to the repository or shared with other browsers/devices. The retained `frontend/data/HELLO.csv` is included as the page's starting reference data.

## Deploying

The GitHub Actions workflow publishes `frontend/` on pushes to `main`. In the repository settings, enable **Pages → Build and deployment → GitHub Actions**. The first deployment can take a few minutes.
