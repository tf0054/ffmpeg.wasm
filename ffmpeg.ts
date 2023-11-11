import * as fs from "fs";
import superjson from "superjson";

import { FFmpeg } from "@ffmpeg.wasm/main";
import joinImages from "join-images";
import sharp from "sharp";
import Occul from "./occuljs/Occul";
import { restart } from "./util";

export const doPhoto = async (_file) => {
  const ffmpeg = await FFmpeg.create({
    core: "@ffmpeg.wasm/core-st",
    log: true,
    logger: console.log,
  });

  const buf = await _file.toBuffer();

  // Wrote
  ffmpeg.fs.writeFile(_file.filename, buf);
  console.log("ffmpeg.fs.ls", ffmpeg.fs.readdir("/"));
  // Processed
  await ffmpeg.run(
    "-i",
    _file.filename,
    "-vf",
    "crop=w='min(min(iw,ih),500)':h='min(min(iw,ih),500)',scale=500:500,setsar=1",
    "cropped.webp",
  );
  console.log("ffmpeg.fs.run", ffmpeg.fs.readdir("/"));
  // Copy back
  const outbuf = ffmpeg.fs.readFile("cropped.webp");
  fs.writeFileSync(`tmp/cropped.webp`, outbuf);

  return outbuf;
};

export const doFfmpeg = async (
  params: { crop: string; milsec: string },
  _file,
  folderName,
  target,
) => {
  const recMilSrc = Math.floor(parseInt(params.milsec) * 100) / 100 / 1000;
  let recMilSecStr =
    recMilSrc > 15 ? "15.00" : `${recMilSrc.toFixed(2)}`.padStart(5, "0");
  // console.log("recMilSecStr", recMilSrc, recMilSecStr); // 01.80
  target.emit("foo", "Preparing 1");

  let ffmpeg = await FFmpeg.create({
    core: "@ffmpeg.wasm/core-st",
    log: true,
    logger: console.log,
  });

  const buf = await _file.toBuffer();

  // console.log("crop", req.body.crop);
  fs.writeFileSync(
    `tmp/${folderName}/${"crop.txt"}`,
    JSON.stringify(params.crop),
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

  target.emit("foo", "Processing 0");
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
      `[0]trim=start=00:00:00.00:end=00:00:${recMilSecStr},fps=10,crop=${params.crop}[vm];` +
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

  target.emit("foo", "Processing 1");
  // console.debug("params for grid creation", paramAry);
  await ffmpeg.run(...paramAry);

  // console.log(await ffmpeg.listDir('/'));

  const gridFilename = "outputs.webp";
  console.debug(`grid creation finished: ${gridFilename}`);
  const buffer = ffmpeg.fs.readFile(gridFilename);
  //
  fs.writeFileSync(`tmp/${folderName}/${gridFilename}`, buffer);

  const width = parseInt(params.crop.split(":")[0]);

  const sharpnessP = Promise.all(occulResAry).then((v) => {
    const resStr = JSON.stringify(v);
    fs.writeFileSync(`tmp/${folderName}/sharpness.json`, resStr);
    return v;
  });

  const composeReelsImages = async (mergeTargets: Buffer[]) => {
    const halfWidth = width / 2;
    const sharpness = await sharpnessP;

    const funcExif = (v: object) => {
      return {
        exif: {
          IFD0: {
            ImageDescription: JSON.stringify(v),
          },
        },
      };
    };

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
        await sharp(buff)
          .withMetadata(
            funcExif({
              sharpness: sharpness[mergeTargets.length - 1],
            }),
          )
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
    let promises: Promise<void>[] = [];
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
        let a = joinImages(await Promise.all([preBuf, pstBuf]), {
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
              .withMetadata(
                funcExif({
                  sharpness: sharpness[i - 1],
                }),
              )
              .toFile(filename)
              .then((v) => {
                console.log(filename);
              });
        });
        promises.push(a);
      }
    } catch (e) {
      console.error(e);
    }
    await Promise.all(promises);

    // @****
    const firstBuf = sharp(mergeTargets[0])
      .resize({ height: reelMeta.height })
      .toBuffer();
    await joinImages(await Promise.all([firstBuf, sharp(reel).toBuffer()]), {
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
          .withMetadata(
            funcExif({
              sharpness_all: sharpness,
              sharpness: sharpness[0],
            }),
          )
          .toFile(filename)
          .then((v) => {
            console.log(filename);
          });
    });
  };

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

  const resultJson = superjson.stringify(resJson);

  composeReelsImages(mergeTargets).then(() => {
    restart();
  });

  fs.writeFileSync(`tmp/${folderName}/${"result.json"}`, resultJson);

  target.emit(
    "foo",
    JSON.stringify({ id: folderName, filename: "result.json" }),
  );

  target.emit("foo", "Done");

  return resultJson;
};
