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

fastify.get(
  "/moz",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          number: { type: "number" },
        },
        required: ["number"],
      },
    },
    // validatorCompiler: ({ schema, method, url, httpPart }) => {
    //   return (data) => {
    //     const { success } = (schema as any).safeParse(data);
    //     return success;
    //   };
    // },
  },
  function (req, reply) {
    return req.params;
  },
);

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

    // //@ts-ignore
    // const artistObj = await getOneShotArtistName('_' + req.body.address.value);
    // if (!artistObj) throw new createError.BadRequest('No artist found');

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

    console.log("crop", req.body.crop);
    fs.writeFileSync(
      `tmp/${folderName}/${"crop.txt"}`,
      JSON.stringify(req.body.crop.value),
    );

    // Wrote
    ffmpeg.fs.writeFile(_file.filename, buf);
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
      "-vsync",
      "vfr",
      "-c:v",
      "libwebp",
      "-filter:v",
      `fps=10,crop=${req.body.crop.value}`,
      "-lossless",
      "1",
      // `-metadata`, `artist="2010"`,
      "output_%03d.webp",
    );

    console.debug("ffmpeg.fs.ls", ffmpeg.fs.readdir("/"));
    // console.debug("zipping started");
    let mergeTargets: Buffer[] = [];
    var outputs: { name: string; lastModified: any; input: any }[] = [];
    const zeroPad = (num: number, places: number) =>
      String(num).padStart(places, "0");
    try {
      const occulObj = new Occul();
      for (let i = 1; i < 1000; i++) {
        const filename = `output_${zeroPad(i, 3)}.webp`;
        const data = await ffmpeg.fs.readFile(filename);
        const output = {
          name: `output_${zeroPad(i, 3)}.webp`,
          lastModified: new Date(),
          input: data,
        };
        fs.writeFileSync(`tmp/${folderName}/` + output.name, data);
        outputs.push(output);
        mergeTargets.push(Buffer.from(data));

        const sharpness = await occulObj.analyze(structuredClone(data));
        console.debug(`Added: ${filename} (${sharpness})`);
      }
    } catch (e) {
      console.log(`Finished: ${outputs.length} ${e}`);
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

    let outFiles: string[][] = [];
    for (let i = 1; i < outputs.length; i++) {
      const filename = `output_${zeroPad(i, 3)}.webp`;
      let params = ["-i", filename];
      outFiles.push(params);
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

    // joinImages(mergeTargets.slice(0, 10), {
    joinImages(mergeTargets, {
      direction: "horizontal",
      offset: -1 * (width / 2),
    }).then(async (img) => {
      const buff = await img.png().toBuffer();
      const metadata = await img.metadata();
      if (metadata.width && metadata.height) {
        const p = width / metadata.width;
        sharp(buff)
          .resize(
            Math.round(p * metadata.width),
            Math.round(p * metadata.height),
          )
          .toFile(`tmp/${folderName}/out.webp`);
        console.log("joined");
      }
    });

    let output = {
      name: `outputs.webp`,
      lastModified: new Date(),
      input: buffer,
    };
    outputs.push(output);

    res.send(superjson.stringify(outputs));
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

