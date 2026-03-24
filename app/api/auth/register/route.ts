import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import { ensureDefaultOrganisation } from "@/lib/organisations";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { User } from "@/lib/models/user";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    await connectDB();

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const organisation = await ensureDefaultOrganisation();

    const user = await User.create({
      organisationId: organisation._id,
      email: email.toLowerCase(),
      password: hashedPassword,
      name: name?.trim() || undefined,
    });

    const organisationMatters = await Matter.find(
      { organisationId: organisation._id },
      { _id: 1 }
    ).lean();

    if (organisationMatters.length > 0) {
      await MatterMember.insertMany(
        organisationMatters.map((matter) => ({
          matterId: matter._id,
          userId: user._id,
        })),
        { ordered: false }
      );
    }

    return NextResponse.json(
      { message: "Account created successfully" },
      { status: 201 }
    );
  } catch (err) {
    console.error("[Register] Error:", err);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
