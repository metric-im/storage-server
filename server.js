import express from 'express';
import StorageServer from './index.mjs';

async function main() {
    const connector = {};
    const storageModule = await StorageServer.mint(connector);

    const app = express();
    app.use(storageModule.routes());
    app.use(storageModule.notFound.bind(storageModule));

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`running on port ${port}`);
    });
}

main().catch(err => {
  console.error('failed', err);
  process.exit(1);
});
