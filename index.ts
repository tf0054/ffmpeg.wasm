import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";

import * as fs from "fs";
import superjson from "superjson";

import { FFmpeg } from "@ffmpeg.wasm/main";
import joinImages from "join-images";
import sharp from "sharp";
import Occul from "./occuljs/Occul";

import { MultipartFile } from "@fastify/multipart";
import createError from "http-errors";

// const path = require("path");

interface BodyType {
  name: string;
  file: MultipartFile;
  crop: { value: string };
}

const fastify = Fastify({
  connectionTimeout: 3000,
  logger: true,
}).withTypeProvider<JsonSchemaToTsProvider>();

// fastify.register(require("@fastify/static"), {
//   root: path.join(__dirname, "public"),
//   prefix: "/public/", // optional: default '/'
// });

fastify.register(cors);
// https://github.com/fastify/fastify-multipart#parse-all-fields-and-assign-them-to-the-body
fastify.register(fastifyMultipart, {
  attachFieldsToBody: true,
  sharedSchemaId: "MultipartFileType",
  limits: {
    fileSize: 10 * 1000 * 1000,
  },
});

fastify.post(
  "/op/ffmpeg/video",
  {
    schema: {
      // description: "Endpoint to update claiming record",
      // tags: ["Qr-claims"],
      headers: {
        type: "object",
        properties: {
          "user-agent": { type: "string" },
        },
        required: ["user-agent"],
      },
      body: {
        type: "object",
        // properties: {
        //   'address': { type: 'string' },
        // },
        required: ["crop", "file"],
      },
      // response: {
      //   204: { type: 'object' },
      // },
      // security: [
      //   {
      //     authorization: [],
      //   },
      // ],
    },
  },
  async (req: FastifyRequest<{ Body: BodyType }>, res) => {
    const _file = req.body.file as MultipartFile;
    if (!_file) throw new createError.BadRequest("No file found");
    if (_file.filename.indexOf("/") > 0)
      throw new createError.BadRequest("Bad filename");

    const asyncCallWithTimeout = async (asyncPromise, timeLimit) => {
      let timeoutHandle;

      const timeoutPromise = new Promise((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("Async call timeout limit reached")),
          timeLimit,
        );
      });

      return Promise.race([asyncPromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
      });
    };

    class TimeoutError extends Error {
      constructor(...args) {
        super(...args);
      }
    }

    // add a timeout to any promise
    function addTimeout(promise, t, timeoutMsg = "timeout") {
      let timer;
      const timerPromise = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timer = null;
          // if the promise has a .cancel() method, then call it
          if (typeof promise.cancel === "function") {
            try {
              promise.cancel();
            } catch (e) {
              console.log(e);
            }
          }
          reject(new TimeoutError(timeoutMsg));
        }, t);
      });
      // make sure the timer doesn't keep running if the promise finished first
      promise.finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      return Promise.race([promise, timerPromise]);
    }

    const ffmpeg = await FFmpeg.create({
      core: "@ffmpeg.wasm/core-st",
      log: true,
      logger: console.log,
    });

    const buf = await _file.toBuffer();

    //@ts-ignore
    // slackPost(
    //   "",
    //   `:national_park: ${_file.filename} (${Math.floor(
    //     buf.length / 1000,
    //   )}kb) is posted via \n${req.headers["user-agent"]}`,
    // );
    const folderName = new Date().toISOString();
    fs.mkdirSync(`tmp/${folderName}`);

    // console.log("crop", req.body.crop);
    fs.writeFileSync(
      `tmp/${folderName}/${"crop.txt"}`,
      JSON.stringify(req.body.crop.value),
    );

    // Write the video on ffpmeg world
    ffmpeg.fs.writeFile(_file.filename, buf);

    // Write the logo on ffpmeg world
    const logoFilename = "logo.png";
    ffmpeg.fs.writeFile(logoFilename, fs.readFileSync(logoFilename));
    console.debug("ffmpeg.fs.ls", ffmpeg.fs.readdir("/"));
    // Processed

    const orgBuf = ffmpeg.fs.readFile(_file.filename);
    fs.writeFileSync(`tmp/${folderName}/${_file.filename}`, orgBuf);

    // await ffmpeg.run(
    //   "-i",
    //   _file.filename,
    //   "-filter:v",
    //   "fps=fps=15",
    //   "_" + _file.filename,
    // );

    // https://ffmpeg.org/ffmpeg-codecs.html#Options-33
    await ffmpeg.run(
      "-i",
      _file.filename,
      "-i",
      logoFilename,
      "-vsync",
      "vfr",
      "-c:v",
      "libwebp",
      "-filter_complex",
      `[1]colorchannelmixer=aa=0.5,scale=iw*40/100:-1[wm];` +
        // `[0]fps=10,crop=${req.body.crop.value}[vm];` +
        `[0]trim=start=00:00:00.00:end=00:00:01.80,fps=10,crop=${req.body.crop.value}[vm];` +
        `[vm][wm]overlay=x=(main_w-overlay_w-5):y=(main_h-overlay_h-5)/(main_h-overlay_h-5)`,
      // `,drawtext=:text='oneshot.tokyo': fontcolor=white@0.5: fontsize=18: x=w-tw-10:y=h-th-10`,
      "-lossless",
      "1",
      // `-metadata`, `artist="2010"`,
      "output_%03d.webp",
    );

    console.debug("ffmpeg.fs.ls", ffmpeg.fs.readdir("/"));

    let mergeTargets: Buffer[] = [];
    var outputs: { name: string; lastModified: any; input: any }[] = [];
    const zeroPad = (num: number, places: number) =>
      String(num).padStart(places, "0");
    try {
      for (let i = 1; i < 1000; i++) {
        const filename = `output_${zeroPad(i, 3)}.webp`;
        const data = ffmpeg.fs.readFile(filename);
        const output = {
          name: `output_${zeroPad(i, 3)}.webp`,
          lastModified: new Date(),
          input: data,
        };
        fs.writeFileSync(`tmp/${folderName}/` + output.name, data);

        outputs.push(output);
        mergeTargets.push(Buffer.from(data));
      }
    } catch (e) {
      console.log(`Finished: ${outputs.length} ${JSON.stringify(e)}`);
    }

    if (outputs.length > 50) outputs = outputs.slice(0, 50);

    console.debug(`grid creation started: ${outputs.length}`);
    let sString = "";
    let counter = 0;

    const xSize = 5;
    const ySize = Math.ceil(outputs.length / xSize);
    for (let y = 0; y < ySize; y++) {
      for (let x = 0; x < xSize; x++) {
        let px = "0",
          py = "0";
        if (x > 0) {
          const ax = Array.from({ length: x }, (value, index) => index);
          ax.map((v) => {
            if (px !== "0") px = `w${v}+${px}`;
            else px = `w${v}`;
          });
        }
        if (y > 0) {
          const ax = Array.from({ length: y }, (value, index) => index);
          ax.map((v) => {
            if (py !== "0") py = `h${v}+${py}`;
            else py = `h${v}`;
          });
        }
        if (counter < outputs.length) {
          sString += `${px}_${py}|`;
        }
      }
    }
    sString = sString.slice(0, -1);

    const occulObj = new Occul();

    let outFiles: string[][] = [];
    let occulResAry: Promise<number>[] = [];
    for (let i = 1; i < outputs.length; i++) {
      const filename = `output_${zeroPad(i, 3)}.webp`;
      let params = ["-i", filename];
      outFiles.push(params);

      occulResAry.push(occulObj.analyze(structuredClone(outputs[i].input)));
    }

    let merged = outFiles.reduce(function (prev, next) {
      return prev.concat(next);
    });

    const paramAry = [
      ...merged,
      "-filter_complex",
      `xstack=inputs=${outputs.length - 1}:layout=${sString},scale=${
        200 * xSize
      }:${200 * ySize}`,
      // "-metadata",
      // 'comment_project="TEST PROJECT"',
      "outputs.webp",
    ];
    // console.debug("params for grid creation", paramAry);
    await ffmpeg.run(...paramAry);

    // console.log(await ffmpeg.listDir('/'));

    const gridFilename = "outputs.webp";
    console.debug(`grid creation finished: ${gridFilename}`);
    const buffer = ffmpeg.fs.readFile(gridFilename);
    //
    fs.writeFileSync(`tmp/${folderName}/${gridFilename}`, buffer);

    const width = parseInt(req.body.crop.value.split(":")[0]);

    const sharpnessP = Promise.all(occulResAry).then((v) => {
      const resStr = JSON.stringify(v);
      fs.writeFileSync(`tmp/${folderName}/sharpness.json`, resStr);
      return resStr;
    });

    const composeReelsImages = async (mergeTargets: Buffer[]) => {
      const halfWidth = width / 2;
      const firstReelFilename = `tmp/${folderName}/reel-${mergeTargets.length
        .toString()
        .padStart(3, "0")}.webp`;
      // ****@
      await joinImages(mergeTargets, {
        direction: "horizontal",
        offset: -1 * halfWidth,
      }).then(async (img) => {
        const buff = await img.png().toBuffer();
        const metadata = await img.metadata();
        if (metadata.width && metadata.height) {
          const p = width / metadata.width;
          const sharpness = await sharpnessP;
          await sharp(buff)
            .withMetadata({
              exif: {
                IFD0: {
                  ImageDescription: sharpness,
                },
              },
            })
            .resize({ height: Math.round(p * metadata.height) })
            .toFile(firstReelFilename)
            .then((v) => {
              console.log(firstReelFilename);
            });
        }
      });

      // *@***
      const reel = fs.readFileSync(firstReelFilename);
      const reelMeta = await sharp(reel).metadata();

      try {
        for (let i = 2; i < mergeTargets.length; i++) {
          let pre = mergeTargets.slice(0, i);
          let pst = mergeTargets.slice(i, mergeTargets.length);
          // console.log(`started pre ${i}`, pre);
          const preBuf = joinImages(pre, {
            direction: "horizontal",
            offset: -1 * halfWidth,
          }).then(async (img) => {
            const buff = await img.png().toBuffer();
            // img.toFile(`tmp/${folderName}/out2-${i}pre.webp`);
            return sharp(buff)
              .resize({ height: reelMeta.height })
              .webp({ lossless: true })
              .toBuffer();
          });
          // console.log(`started pst ${i}`, pst);
          const pstBuf = joinImages(pst, {
            direction: "horizontal",
            offset: -1 * halfWidth,
          }).then(async (img) => {
            const buff = await img.png().toBuffer();
            // img.toFile(`tmp/${folderName}/out2-${i}pst.webp`);
            return sharp(buff)
              .resize({ height: reelMeta.height })
              .webp({ lossless: true })
              .toBuffer();
          });
          // console.log("kk", preBuf, pstBuf, "jj");
          joinImages(await Promise.all([preBuf, pstBuf]), {
            direction: "horizontal",
          }).then(async (img) => {
            const meta = await img.metadata();
            const filename = `tmp/${folderName}/reel-${i
              .toString()
              .padStart(3, "0")}.webp`;
            // console.log(JSON.stringify(meta), JSON.stringify(reelMeta));
            if (meta.width && meta.height && reelMeta.height)
              img
                .extract({
                  left: 0,
                  top: 0,
                  width: meta.width - reelMeta.height / 2,
                  height: meta.height,
                })
                // .resize({ height: reelMeta.height })
                .toFile(filename)
                .then((v) => {
                  console.log(filename);
                });
          });
        }
      } catch (e) {
        console.error(e);
      }

      // @****
      const firstBuf = await sharp(mergeTargets[0])
        .resize({ height: reelMeta.height })
        .toBuffer();
      joinImages([firstBuf, await sharp(reel).toBuffer()], {
        direction: "horizontal",
      }).then(async (img) => {
        const metadata = await img.metadata();
        const filename = `tmp/${folderName}/reel-001.webp`;
        if (metadata.width && metadata.height && reelMeta.height)
          img
            .extract({
              left: 0,
              top: 0,
              width: metadata.width - reelMeta.height / 2,
              height: metadata.height,
            })
            .toFile(filename)
            .then((v) => {
              console.log(filename);
            });
      });
    };
    composeReelsImages(mergeTargets);

    if (ffmpeg.exit("kill")) {
      console.log("ffmpeg: killed");
    }

    let output = {
      name: `outputs.webp`,
      lastModified: new Date(),
      input: buffer,
    };
    outputs.push(output);

    const resJson = { id: folderName, photos: outputs };

    res.send(superjson.stringify(resJson));
  },
);

fastify.get(
  "/op/ffmpeg/video/sharpness/:folderId",
  {
    schema: {},
  },
  function (req, reply) {
    const { folderId } = req.params;
    const content = fs.readFileSync(`tmp/${folderId}/sharpness.json`);
    reply.send(content);
  },
);

fastify.get(
  "/op/ffmpeg/video/:folderId/:filename",
  {
    schema: {},
  },
  function (req, reply) {
    const { folderId, filename } = req.params;
    const content = fs.readFileSync(`tmp/${folderId}/${filename}`);
    reply.send(content);
  },
);

// Run the server!
fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    console.log(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
