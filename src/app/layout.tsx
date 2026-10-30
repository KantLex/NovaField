import type { Metadata } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";
import { Shell } from "@/ui/Shell";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "NovaField",
  description: "A film studio for your own GPU: direct shots, move the camera, transform footage. Runs on ComfyUI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} antialiased`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
