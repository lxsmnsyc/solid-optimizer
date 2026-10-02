# showcase

Renders the comparison image in the README.

`App.jsx` is compiled by Solid's JSX transform alone and with `solid-optimizer` first, then rendered on the server both ways. The results are saved as `comparison.png` through headless Chrome.

```bash
pnpm --filter solid-optimizer build
pnpm --filter showcase showcase
```

Set `CHROME` to the Chrome binary when it is not at the default macOS location.
